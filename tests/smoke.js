// End-to-end smoke test: verifies IIT Roorkee email domain restriction, auth,
// request -> claim -> handover -> borrower confirmation -> return lifecycle,
// senior inventory catalog, comments, notifications, and stats.
const assert = require('assert');

process.env.DATA_FILE = ':memory:';
process.env.FORCE_JSON_STORE = '1';
process.env.JWT_SECRET = 'test-secret-iitr-component-share';
process.env.ENFORCE_CAMPUS_EMAIL = 'true';
process.env.ALLOWED_EMAIL_DOMAINS = 'iitr.ac.in';

const db = require('../db');
const app = require('../server');

const future = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

(async () => {
  await db.resetForTests();
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}/api`;

  async function call(method, url, token, body) {
    const res = await fetch(base + url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
  }

  let passed = 0;
  const ok = (name) => {
    passed++;
    console.log('  ok  ' + name);
  };

  try {
    // 1. Campus email domain restriction (IIT Roorkee)
    let r = await call('POST', '/auth/register', null, {
      name: 'Outside User',
      email: 'someone@gmail.com',
      password: 'password123',
      role: 'junior',
    });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /iitr\.ac\.in/i);
    ok('rejects non-IIT Roorkee email (@gmail.com)');

    // 2. Register Junior & Senior with IIT Roorkee emails (@iitr.ac.in and @ece.iitr.ac.in)
    r = await call('POST', '/auth/register', null, {
      name: 'Junior Riya',
      email: 'riya@ece.iitr.ac.in',
      password: 'password123',
      role: 'junior',
      enrollment_no: '25116042',
      branch: 'ECE',
      year: 1,
      phone: '9876500001',
      hostel: 'Kasturba Bhawan',
    });
    assert.equal(r.status, 201);
    const jt = r.data.token;
    ok('junior registers with @ece.iitr.ac.in');

    r = await call('POST', '/auth/register', null, {
      name: 'Senior Udit',
      email: 'udit@iitr.ac.in',
      password: 'password123',
      role: 'senior',
      enrollment_no: '22114001',
      branch: 'CSE',
      year: 4,
      phone: '9876500006',
      hostel: 'Radhakrishnan Bhawan',
    });
    assert.equal(r.status, 201);
    const st = r.data.token;
    ok('senior registers with @iitr.ac.in');

    // 3. Duplicate email & bad password checks
    r = await call('POST', '/auth/register', null, {
      name: 'Dup',
      email: 'riya@ece.iitr.ac.in',
      password: 'password123',
      role: 'junior',
    });
    assert.equal(r.status, 409);
    ok('duplicate campus email rejected');

    r = await call('POST', '/auth/login', null, { email: 'riya@ece.iitr.ac.in', password: 'wrongpass' });
    assert.equal(r.status, 401);
    ok('bad password rejected');

    r = await call('GET', '/requests', null);
    assert.equal(r.status, 401);
    ok('feed requires authentication');

    // 4. Senior inventory listing
    r = await call('POST', '/inventory', st, {
      component: 'STM32 Nucleo-64',
      category: 'Microcontrollers',
      quantity: 1,
      condition: 'New',
      share_type: 'lend',
      description: 'Available at Radhakrishnan Bhawan',
    });
    assert.equal(r.status, 201);
    const invId = r.data.item.id;
    ok('senior lists idle component in inventory');

    r = await call('GET', '/inventory?q=stm32', jt);
    assert.equal(r.status, 200);
    assert.equal(r.data.items.length, 1);
    ok('junior searches available senior inventory');

    r = await call('PATCH', `/inventory/${invId}/toggle`, st);
    assert.equal(r.status, 200);
    assert.equal(r.data.item.available, false);
    ok('senior toggles inventory availability');

    // 5. Request creation & validation
    r = await call('POST', '/requests', st, { title: 'x', component: 'x' });
    assert.equal(r.status, 403);
    ok('senior cannot post request');

    r = await call('POST', '/requests', jt, {
      title: 'Arduino Uno for line follower',
      component: 'Arduino Uno',
      category: 'Microcontrollers',
      quantity: 1,
      project_scope: 'Line follower robot project for Shrishti exhibition',
      needed_from: future(1),
      needed_until: future(14),
    });
    assert.equal(r.status, 201);
    const id = r.data.request.id;
    ok('junior posts request');

    r = await call('POST', '/requests', jt, {
      title: 'Bad dates',
      component: 'x1',
      project_scope: 'long enough scope description',
      needed_from: future(5),
      needed_until: future(1),
    });
    assert.equal(r.status, 400);
    ok('invalid dates rejected');

    // 6. Feed search & privacy before claim
    r = await call('GET', '/requests?q=arduino', st);
    assert.equal(r.data.requests.length, 1);
    assert.equal(r.data.requests[0].contact, undefined);
    ok('senior sees request, contact hidden before claim');

    // 7. Request comments / discussion
    r = await call('POST', `/requests/${id}/comments`, st, {
      body: 'Do you also need the USB-B cable and jumper wires?',
    });
    assert.equal(r.status, 201);
    ok('senior posts comment on request');

    // 8. Claim flow
    r = await call('POST', `/requests/${id}/claim`, jt, {});
    assert.equal(r.status, 403);
    ok('junior cannot claim');

    r = await call('POST', `/requests/${id}/claim`, st, {
      claim_type: 'lend',
      claim_note: 'Free tomorrow near Nesci',
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.request.status, 'claimed');
    assert.equal(r.data.request.contact.email, 'riya@ece.iitr.ac.in');
    ok('senior claims request and unlocks junior contact');

    r = await call('POST', `/requests/${id}/claim`, st, {});
    assert.equal(r.status, 409);
    ok('double claim blocked');

    r = await call('GET', `/requests/${id}`, jt);
    assert.equal(r.data.request.contact.email, 'udit@iitr.ac.in');
    assert.equal(r.data.comments.length, 1);
    ok('junior gets senior contact and sees discussion comments');

    // 9. Handover & borrower receipt confirmation
    r = await call('POST', `/requests/${id}/handover`, st, {
      expected_return: future(10),
      condition_note: 'Working board with USB cable',
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.request.status, 'checked_out');
    ok('handover logged by senior');

    r = await call('POST', `/requests/${id}/confirm-receipt`, jt, {});
    assert.equal(r.status, 200);
    assert.equal(r.data.request.borrower_confirmed, true);
    ok('borrower confirms hardware receipt');

    r = await call('GET', '/checkouts', jt);
    assert.equal(r.data.checkouts.length, 1);
    assert.equal(r.data.checkouts[0].role, 'borrower');
    assert.equal(r.data.checkouts[0].status, 'active');
    ok('checkout visible to borrower');

    r = await call('GET', '/stats', null);
    assert.equal(r.data.active_checkouts, 1);
    ok('public stats updated');

    // 10. Return flow
    r = await call('POST', `/requests/${id}/return`, jt, {});
    assert.equal(r.status, 403);
    ok('junior cannot confirm return');

    r = await call('POST', `/requests/${id}/return`, st, { condition_note: 'Returned in great shape' });
    assert.equal(r.status, 200);
    assert.equal(r.data.request.status, 'returned');
    ok('lender confirms return');

    r = await call('GET', '/checkouts?status=returned', st);
    assert.equal(r.data.checkouts.length, 1);
    ok('returned checkout in history');

    // 11. Notifications
    r = await call('GET', '/notifications', jt);
    assert.equal(r.status, 200);
    assert.ok(r.data.notifications.length >= 3);
    ok('notifications recorded for lifecycle events');

    // 12. Cancel path
    r = await call('POST', '/requests', jt, {
      title: 'ESP32 board',
      component: 'ESP32',
      project_scope: 'IoT project for the course',
      needed_from: future(1),
      needed_until: future(9),
    });
    const id2 = r.data.request.id;
    r = await call('POST', `/requests/${id2}/cancel`, jt);
    assert.equal(r.data.request.status, 'cancelled');
    ok('junior cancels open request');

    console.log(`\nAll ${passed} checks passed.`);
  } catch (e) {
    console.error('\nFAILED:', e);
    process.exitCode = 1;
  } finally {
    server.close();
  }
})();
