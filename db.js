const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const v = require('./utils/validate');
const { hashPassword } = require('./utils/crypto-auth');
const { createModels } = require('./models/schemas');

let mongoose = null;
try {
  mongoose = require('mongoose');
} catch {
  mongoose = null;
}

let mode = 'uninitialized'; // 'mongodb' | 'json-store'
let models = null;
let connectionInfo = { engine: 'initializing', connected: false, uri_type: null, note: null };

// Local JSON document store state (used when MongoDB is unreachable or in :memory: test mode)
let store = {
  users: [],
  requests: [],
  checkouts: [],
  inventory: [],
  comments: [],
  notifications: [],
};

const getDataFile = () => process.env.DATA_FILE || config.DATA_FILE;

function loadStore() {
  const file = getDataFile();
  if (file === ':memory:') return;
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      store = {
        users: raw.users || [],
        requests: raw.requests || [],
        checkouts: raw.checkouts || [],
        inventory: raw.inventory || [],
        comments: raw.comments || [],
        notifications: raw.notifications || [],
      };
    }
  } catch (err) {
    console.warn('[db] Could not read existing store file, starting fresh:', err.message);
  }
}

function saveStore() {
  const file = getDataFile();
  if (file === ':memory:' || mode === 'mongodb') return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2), 'utf8');
}

const genId = () => crypto.randomBytes(12).toString('hex');
const nowIso = () => new Date().toISOString();

async function connect() {
  if (mode !== 'uninitialized') return connectionInfo;

  const dataFile = getDataFile();
  if (dataFile === ':memory:' || process.env.FORCE_JSON_STORE === '1') {
    mode = 'json-store';
    connectionInfo = {
      engine: 'memory-document-store',
      connected: true,
      uri_type: 'memory',
      note: 'Running in-memory document store for isolated testing',
    };
    return connectionInfo;
  }

  if (mongoose && config.MONGODB_URI) {
    try {
      await mongoose.connect(config.MONGODB_URI, {
        serverSelectionTimeoutMS: 4500,
        connectTimeoutMS: 4500,
      });
      models = createModels(mongoose);
      mode = 'mongodb';
      connectionInfo = {
        engine: 'mongodb-atlas',
        connected: true,
        uri_type: 'atlas',
        database: config.MONGO_DB_NAME,
        user: config.MONGO_USER,
      };
      console.log(`[db] Connected to MongoDB Atlas (${config.MONGO_DB_NAME}) as ${config.MONGO_USER}`);
      return connectionInfo;
    } catch (atlasErr) {
      console.warn(`[db] MongoDB Atlas connection attempt failed (${atlasErr.message}).`);
      if (config.MONGODB_LOCAL_URI) {
        try {
          await mongoose.connect(config.MONGODB_LOCAL_URI, {
            serverSelectionTimeoutMS: 2000,
            connectTimeoutMS: 2000,
          });
          models = createModels(mongoose);
          mode = 'mongodb';
          connectionInfo = {
            engine: 'mongodb-local',
            connected: true,
            uri_type: 'local',
            database: config.MONGO_DB_NAME,
          };
          console.log(`[db] Connected to local MongoDB (${config.MONGODB_LOCAL_URI})`);
          return connectionInfo;
        } catch {
          // Proceed to fallback check
        }
      }
      if (!config.DB_AUTO_FALLBACK) {
        throw atlasErr;
      }
      console.warn(
        '[db] Falling back to local persistent JSON document store (data/campus-db.json). ' +
        'Tip: In MongoDB Atlas -> Clusters -> Click "Connect" -> "Drivers" to copy your exact Cluster0 subdomain (e.g. cluster0.xxxxx.mongodb.net) into .env and ensure Network Access allows your IP (0.0.0.0/0).'
      );
    }
  }

  mode = 'json-store';
  loadStore();
  connectionInfo = {
    engine: 'local-document-store',
    connected: true,
    uri_type: 'file',
    file: path.basename(dataFile),
    note: 'Using persistent local document store (MongoDB Atlas fallback active)',
  };
  return connectionInfo;
}

function normalizeDoc(doc) {
  if (!doc) return null;
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  if (obj._id && !obj.id) obj.id = String(obj._id);
  delete obj._id;
  delete obj.__v;
  return obj;
}

/* ---------- Users Repository ---------- */
const users = {
  async findByEmail(email) {
    await connect();
    const clean = String(email || '').trim().toLowerCase();
    if (mode === 'mongodb') {
      return normalizeDoc(await models.User.findOne({ email: clean }));
    }
    return normalizeDoc(store.users.find((u) => u.email === clean));
  },

  async findById(id) {
    await connect();
    if (!id) return null;
    if (mode === 'mongodb') {
      if (!mongoose.Types.ObjectId.isValid(id)) return null;
      return normalizeDoc(await models.User.findById(id));
    }
    return normalizeDoc(store.users.find((u) => String(u.id) === String(id)));
  },

  async create(data) {
    await connect();
    const payload = {
      name: data.name,
      email: String(data.email).toLowerCase(),
      password_hash: data.password_hash,
      role: data.role,
      enrollment_no: data.enrollment_no || null,
      branch: data.branch || null,
      year: data.year ?? null,
      phone: data.phone || null,
      hostel: data.hostel || null,
      bio: data.bio || null,
      reputation: data.reputation || 0,
      created_at: nowIso(),
    };
    if (mode === 'mongodb') {
      const created = await models.User.create(payload);
      return normalizeDoc(created);
    }
    const doc = { id: genId(), ...payload };
    store.users.push(doc);
    saveStore();
    return normalizeDoc(doc);
  },

  async update(id, updates) {
    await connect();
    if (mode === 'mongodb') {
      const updated = await models.User.findByIdAndUpdate(id, { $set: updates }, { new: true });
      return normalizeDoc(updated);
    }
    const idx = store.users.findIndex((u) => String(u.id) === String(id));
    if (idx === -1) return null;
    store.users[idx] = { ...store.users[idx], ...updates };
    saveStore();
    return normalizeDoc(store.users[idx]);
  },

  async addReputation(id, points) {
    await connect();
    if (mode === 'mongodb') {
      await models.User.findByIdAndUpdate(id, { $inc: { reputation: points } });
      return;
    }
    const u = store.users.find((x) => String(x.id) === String(id));
    if (u) {
      u.reputation = (u.reputation || 0) + points;
      saveStore();
    }
  },

  async count() {
    await connect();
    if (mode === 'mongodb') return models.User.countDocuments();
    return store.users.length;
  },
};

/* ---------- Notifications Repository ---------- */
const notifications = {
  async create(userId, message, link = '#/') {
    await connect();
    if (!userId) return null;
    const payload = {
      user_id: String(userId),
      message,
      link,
      read: false,
      created_at: nowIso(),
    };
    if (mode === 'mongodb') {
      return normalizeDoc(await models.Notification.create(payload));
    }
    const doc = { id: genId(), ...payload };
    store.notifications.push(doc);
    saveStore();
    return normalizeDoc(doc);
  },

  async listForUser(userId) {
    await connect();
    let list;
    if (mode === 'mongodb') {
      const docs = await models.Notification.find({ user_id: String(userId) })
        .sort({ created_at: -1 })
        .limit(40);
      list = docs.map(normalizeDoc);
    } else {
      list = store.notifications
        .filter((n) => String(n.user_id) === String(userId))
        .sort((a, b) => (b.created_at > a.created_at ? 1 : -1))
        .slice(0, 40)
        .map(normalizeDoc);
    }
    const unread = list.filter((n) => !n.read).length;
    return { notifications: list, unread };
  },

  async markAllRead(userId) {
    await connect();
    if (mode === 'mongodb') {
      await models.Notification.updateMany({ user_id: String(userId), read: false }, { $set: { read: true } });
      return;
    }
    store.notifications.forEach((n) => {
      if (String(n.user_id) === String(userId)) n.read = true;
    });
    saveStore();
  },
};

/* ---------- Requests & Checkouts Serialization Helper ---------- */
async function hydrateRequest(rawReq, viewer) {
  if (!rawReq) return null;
  const r = normalizeDoc(rawReq);
  const [junior, senior] = await Promise.all([
    users.findById(r.junior_id),
    r.claimed_by ? users.findById(r.claimed_by) : Promise.resolve(null),
  ]);

  let checkout = null;
  if (mode === 'mongodb') {
    checkout = normalizeDoc(await models.Checkout.findOne({ request_id: String(r.id) }));
  } else {
    checkout = normalizeDoc(store.checkouts.find((c) => String(c.request_id) === String(r.id)));
  }

  let commentCount = 0;
  if (mode === 'mongodb') {
    commentCount = await models.Comment.countDocuments({ request_id: String(r.id) });
  } else {
    commentCount = store.comments.filter((c) => String(c.request_id) === String(r.id)).length;
  }

  const viewerId = viewer ? String(viewer.id) : null;
  const isJunior = viewerId && String(r.junior_id) === viewerId;
  const isSenior = viewerId && r.claimed_by && String(r.claimed_by) === viewerId;
  const connected = ['claimed', 'checked_out', 'returned'].includes(r.status);

  const expectedReturn = checkout ? checkout.expected_return : null;
  const out = {
    id: String(r.id),
    title: r.title,
    component: r.component,
    category: r.category || 'Microcontrollers',
    quantity: r.quantity,
    project_scope: r.project_scope,
    needed_from: r.needed_from,
    needed_until: r.needed_until,
    status: r.status,
    created_at: r.created_at,
    claimed_at: r.claimed_at || null,
    claim_type: r.claim_type || null,
    rent_amount: r.rent_amount ?? null,
    claim_note: r.claim_note || null,
    handed_over_at: checkout ? checkout.handed_over_at : null,
    expected_return: expectedReturn,
    returned_at: checkout ? checkout.returned_at : null,
    condition_note: checkout ? checkout.condition_note : null,
    borrower_confirmed: checkout ? Boolean(checkout.borrower_confirmed) : false,
    comment_count: commentCount,
    junior: junior
      ? { id: String(junior.id), name: junior.name, branch: junior.branch, year: junior.year, hostel: junior.hostel }
      : { id: String(r.junior_id), name: 'Campus Member', branch: null, year: null },
    senior: senior
      ? { id: String(senior.id), name: senior.name, branch: senior.branch, year: senior.year, reputation: senior.reputation || 0 }
      : null,
    is_mine: Boolean(isJunior),
    is_lender: Boolean(isSenior),
    overdue: r.status === 'checked_out' && Boolean(expectedReturn) && expectedReturn < v.today(),
  };

  if (connected && (isJunior || isSenior)) {
    const other = isJunior ? senior : junior;
    if (other) {
      out.contact = {
        name: other.name,
        email: other.email,
        phone: other.phone,
        hostel: other.hostel,
        enrollment_no: other.enrollment_no,
      };
    }
  }
  return out;
}

/* ---------- Requests Repository ---------- */
const requests = {
  async list({ status = 'open', mine = false, q = '', category = '' } = {}, viewer) {
    await connect();
    let docs;
    if (mode === 'mongodb') {
      const filter = {};
      if (status && status !== 'all') filter.status = status;
      if (category && category !== 'all') filter.category = category;
      if (mine && viewer) {
        filter.$or = [{ junior_id: String(viewer.id) }, { claimed_by: String(viewer.id) }];
      }
      if (q) {
        const regex = new RegExp(String(q).trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const qOr = [{ title: regex }, { component: regex }, { project_scope: regex }, { category: regex }];
        if (filter.$or) {
          filter.$and = [{ $or: filter.$or }, { $or: qOr }];
          delete filter.$or;
        } else {
          filter.$or = qOr;
        }
      }
      docs = await models.Request.find(filter).sort({ created_at: -1 }).limit(100);
    } else {
      docs = [...store.requests];
      if (status && status !== 'all') {
        docs = docs.filter((r) => r.status === status);
      }
      if (category && category !== 'all') {
        docs = docs.filter((r) => (r.category || 'Microcontrollers') === category);
      }
      if (mine && viewer) {
        const uid = String(viewer.id);
        docs = docs.filter((r) => String(r.junior_id) === uid || String(r.claimed_by) === uid);
      }
      if (q) {
        const needle = String(q).trim().toLowerCase().slice(0, 60);
        docs = docs.filter(
          (r) =>
            (r.title && r.title.toLowerCase().includes(needle)) ||
            (r.component && r.component.toLowerCase().includes(needle)) ||
            (r.project_scope && r.project_scope.toLowerCase().includes(needle)) ||
            (r.category && r.category.toLowerCase().includes(needle))
        );
      }
      docs.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
      docs = docs.slice(0, 100);
    }
    return Promise.all(docs.map((d) => hydrateRequest(d, viewer)));
  },

  async findById(id, viewer) {
    await connect();
    if (!id) return null;
    let raw = null;
    if (mode === 'mongodb') {
      if (!mongoose.Types.ObjectId.isValid(id)) return null;
      raw = await models.Request.findById(id);
    } else {
      raw = store.requests.find((r) => String(r.id) === String(id));
    }
    return hydrateRequest(raw, viewer);
  },

  async create(data, viewer) {
    await connect();
    const payload = {
      junior_id: String(viewer.id),
      title: data.title,
      component: data.component,
      category: data.category || 'Microcontrollers',
      quantity: data.quantity,
      project_scope: data.project_scope,
      needed_from: data.needed_from,
      needed_until: data.needed_until,
      status: 'open',
      claimed_by: null,
      claim_type: null,
      rent_amount: null,
      claim_note: null,
      claimed_at: null,
      inventory_id: data.inventory_id || null,
      created_at: nowIso(),
    };
    let raw;
    if (mode === 'mongodb') {
      raw = await models.Request.create(payload);
    } else {
      raw = { id: genId(), ...payload };
      store.requests.push(raw);
      saveStore();
    }

    // Notify the senior who listed this item in the Parts Catalog
    if (data.inventory_id) {
      let invItem = null;
      if (mode === 'mongodb') {
        if (mongoose.Types.ObjectId.isValid(data.inventory_id)) {
          invItem = normalizeDoc(await models.Inventory.findById(data.inventory_id));
        }
      } else {
        invItem = normalizeDoc(
          store.inventory.find((i) => String(i.id) === String(data.inventory_id))
        );
      }

      const normReq = normalizeDoc(raw);
      if (invItem && invItem.senior_id && String(invItem.senior_id) !== String(viewer.id)) {
        await notifications.create(
          invItem.senior_id,
          `${viewer.name} requested your catalog item "${invItem.component}" (${data.quantity}x) — click to review & claim.`,
          `#/request/${normReq.id}`
        );
      }
    }

    return hydrateRequest(raw, viewer);
  },

  async claim(id, seniorUser, { claim_type, rent_amount, claim_note }) {
    await connect();
    const seniorId = String(seniorUser.id);
    const claimedAt = nowIso();
    let raw;
    if (mode === 'mongodb') {
      if (!mongoose.Types.ObjectId.isValid(id)) return null;
      raw = await models.Request.findOneAndUpdate(
        { _id: id, status: 'open', junior_id: { $ne: seniorId } },
        {
          $set: {
            status: 'claimed',
            claimed_by: seniorId,
            claim_type,
            rent_amount,
            claim_note,
            claimed_at: claimedAt,
          },
        },
        { new: true }
      );
    } else {
      const idx = store.requests.findIndex(
        (r) => String(r.id) === String(id) && r.status === 'open' && String(r.junior_id) !== seniorId
      );
      if (idx === -1) return null;
      store.requests[idx] = {
        ...store.requests[idx],
        status: 'claimed',
        claimed_by: seniorId,
        claim_type,
        rent_amount,
        claim_note,
        claimed_at: claimedAt,
      };
      saveStore();
      raw = store.requests[idx];
    }
    if (!raw) return null;
    const norm = normalizeDoc(raw);
    await notifications.create(
      norm.junior_id,
      `${seniorUser.name} claimed your request for "${norm.component}" (${claim_type === 'rent' ? 'INR ' + rent_amount : 'Free lend'}).`,
      `#/request/${norm.id}`
    );
    return hydrateRequest(raw, seniorUser);
  },

  async unclaim(id, seniorUser) {
    await connect();
    const seniorId = String(seniorUser.id);
    let raw;
    if (mode === 'mongodb') {
      if (!mongoose.Types.ObjectId.isValid(id)) return null;
      raw = await models.Request.findOneAndUpdate(
        { _id: id, status: 'claimed', claimed_by: seniorId },
        {
          $set: {
            status: 'open',
            claimed_by: null,
            claim_type: null,
            rent_amount: null,
            claim_note: null,
            claimed_at: null,
          },
        },
        { new: true }
      );
    } else {
      const idx = store.requests.findIndex(
        (r) => String(r.id) === String(id) && r.status === 'claimed' && String(r.claimed_by) === seniorId
      );
      if (idx === -1) return null;
      store.requests[idx] = {
        ...store.requests[idx],
        status: 'open',
        claimed_by: null,
        claim_type: null,
        rent_amount: null,
        claim_note: null,
        claimed_at: null,
      };
      saveStore();
      raw = store.requests[idx];
    }
    if (!raw) return null;
    const norm = normalizeDoc(raw);
    await notifications.create(
      norm.junior_id,
      `${seniorUser.name} released the claim on "${norm.component}". Your request is open again.`,
      `#/request/${norm.id}`
    );
    return hydrateRequest(raw, seniorUser);
  },

  async cancel(id, user) {
    await connect();
    const userId = String(user.id);
    let raw;
    let prevClaimedBy = null;
    if (mode === 'mongodb') {
      if (!mongoose.Types.ObjectId.isValid(id)) return null;
      const existing = await models.Request.findOne({
        _id: id,
        junior_id: userId,
        status: { $in: ['open', 'claimed'] },
      });
      if (!existing) return null;
      prevClaimedBy = existing.claimed_by;
      existing.status = 'cancelled';
      await existing.save();
      raw = existing;
    } else {
      const idx = store.requests.findIndex(
        (r) =>
          String(r.id) === String(id) &&
          String(r.junior_id) === userId &&
          ['open', 'claimed'].includes(r.status)
      );
      if (idx === -1) return null;
      prevClaimedBy = store.requests[idx].claimed_by;
      store.requests[idx].status = 'cancelled';
      saveStore();
      raw = store.requests[idx];
    }
    const norm = normalizeDoc(raw);
    if (prevClaimedBy) {
      await notifications.create(
        prevClaimedBy,
        `${user.name} cancelled their request for "${norm.component}".`,
        `#/request/${norm.id}`
      );
    }
    return hydrateRequest(raw, user);
  },

  async handover(id, seniorUser, { expected_return, condition_note }) {
    await connect();
    const seniorId = String(seniorUser.id);
    const handedOverAt = nowIso();
    let raw;
    if (mode === 'mongodb') {
      if (!mongoose.Types.ObjectId.isValid(id)) return null;
      const reqDoc = await models.Request.findOne({ _id: id, status: 'claimed', claimed_by: seniorId });
      if (!reqDoc) return null;
      await models.Checkout.create({
        request_id: String(reqDoc._id),
        lender_id: seniorId,
        borrower_id: String(reqDoc.junior_id),
        handed_over_at: handedOverAt,
        expected_return,
        returned_at: null,
        condition_note: condition_note || null,
        borrower_confirmed: false,
      });
      reqDoc.status = 'checked_out';
      await reqDoc.save();
      raw = reqDoc;
    } else {
      const idx = store.requests.findIndex(
        (r) => String(r.id) === String(id) && r.status === 'claimed' && String(r.claimed_by) === seniorId
      );
      if (idx === -1) return null;
      const reqObj = store.requests[idx];
      store.checkouts.push({
        id: genId(),
        request_id: String(reqObj.id),
        lender_id: seniorId,
        borrower_id: String(reqObj.junior_id),
        handed_over_at: handedOverAt,
        expected_return,
        returned_at: null,
        condition_note: condition_note || null,
        borrower_confirmed: false,
      });
      store.requests[idx].status = 'checked_out';
      saveStore();
      raw = store.requests[idx];
    }
    const norm = normalizeDoc(raw);
    await users.addReputation(seniorId, 10);
    await notifications.create(
      norm.junior_id,
      `${seniorUser.name} logged the handover of "${norm.component}" (due back ${expected_return}).`,
      `#/request/${norm.id}`
    );
    return hydrateRequest(raw, seniorUser);
  },

  async confirmReceipt(id, juniorUser) {
    await connect();
    const juniorId = String(juniorUser.id);
    let raw;
    if (mode === 'mongodb') {
      if (!mongoose.Types.ObjectId.isValid(id)) return null;
      const reqDoc = await models.Request.findOne({ _id: id, status: 'checked_out', junior_id: juniorId });
      if (!reqDoc) return null;
      await models.Checkout.findOneAndUpdate(
        { request_id: String(reqDoc._id) },
        { $set: { borrower_confirmed: true } }
      );
      raw = reqDoc;
    } else {
      const reqObj = store.requests.find(
        (r) => String(r.id) === String(id) && r.status === 'checked_out' && String(r.junior_id) === juniorId
      );
      if (!reqObj) return null;
      const co = store.checkouts.find((c) => String(c.request_id) === String(reqObj.id));
      if (co) co.borrower_confirmed = true;
      saveStore();
      raw = reqObj;
    }
    const norm = normalizeDoc(raw);
    if (norm.claimed_by) {
      await notifications.create(
        norm.claimed_by,
        `${juniorUser.name} confirmed receiving "${norm.component}".`,
        `#/request/${norm.id}`
      );
    }
    return hydrateRequest(raw, juniorUser);
  },

  async returnHardware(id, seniorUser, { condition_note } = {}) {
    await connect();
    const seniorId = String(seniorUser.id);
    const returnedAt = nowIso();
    let raw;
    if (mode === 'mongodb') {
      if (!mongoose.Types.ObjectId.isValid(id)) return null;
      const reqDoc = await models.Request.findOne({ _id: id, status: 'checked_out', claimed_by: seniorId });
      if (!reqDoc) return null;
      const updateFields = { returned_at: returnedAt };
      if (condition_note) updateFields.condition_note = condition_note;
      await models.Checkout.findOneAndUpdate({ request_id: String(reqDoc._id) }, { $set: updateFields });
      reqDoc.status = 'returned';
      await reqDoc.save();
      raw = reqDoc;
    } else {
      const idx = store.requests.findIndex(
        (r) => String(r.id) === String(id) && r.status === 'checked_out' && String(r.claimed_by) === seniorId
      );
      if (idx === -1) return null;
      const reqObj = store.requests[idx];
      const co = store.checkouts.find((c) => String(c.request_id) === String(reqObj.id));
      if (co) {
        co.returned_at = returnedAt;
        if (condition_note) co.condition_note = condition_note;
      }
      store.requests[idx].status = 'returned';
      saveStore();
      raw = store.requests[idx];
    }
    const norm = normalizeDoc(raw);
    await users.addReputation(seniorId, 15);
    await notifications.create(
      norm.junior_id,
      `${seniorUser.name} confirmed the return of "${norm.component}". Thanks for keeping campus hardware circulating!`,
      `#/request/${norm.id}`
    );
    return hydrateRequest(raw, seniorUser);
  },
};

/* ---------- Checkouts Repository ---------- */
const checkouts = {
  async listForUser(userId, statusFilter) {
    await connect();
    const uid = String(userId);
    let rawList;
    if (mode === 'mongodb') {
      const docs = await models.Checkout.find({
        $or: [{ lender_id: uid }, { borrower_id: uid }],
      }).sort({ expected_return: 1 });
      rawList = docs.map(normalizeDoc);
    } else {
      rawList = store.checkouts
        .filter((c) => String(c.lender_id) === uid || String(c.borrower_id) === uid)
        .map(normalizeDoc);
    }

    const today = v.today();
    const hydrated = await Promise.all(
      rawList.map(async (c) => {
        let reqDoc = null;
        if (mode === 'mongodb') {
          if (mongoose.Types.ObjectId.isValid(c.request_id)) {
            reqDoc = normalizeDoc(await models.Request.findById(c.request_id));
          }
        } else {
          reqDoc = normalizeDoc(store.requests.find((r) => String(r.id) === String(c.request_id)));
        }
        const [lender, borrower] = await Promise.all([
          users.findById(c.lender_id),
          users.findById(c.borrower_id),
        ]);
        const iAmLender = String(c.lender_id) === uid;
        const otherUser = iAmLender ? borrower : lender;
        return {
          id: String(c.id),
          request_id: String(c.request_id),
          title: reqDoc ? reqDoc.title : 'Component Checkout',
          component: reqDoc ? reqDoc.component : 'Hardware',
          category: reqDoc ? reqDoc.category || 'Microcontrollers' : 'Microcontrollers',
          quantity: reqDoc ? reqDoc.quantity : 1,
          claim_type: reqDoc ? reqDoc.claim_type : 'lend',
          rent_amount: reqDoc ? reqDoc.rent_amount : null,
          handed_over_at: c.handed_over_at,
          expected_return: c.expected_return,
          returned_at: c.returned_at,
          condition_note: c.condition_note || null,
          borrower_confirmed: Boolean(c.borrower_confirmed),
          role: iAmLender ? 'lender' : 'borrower',
          status: c.returned_at ? 'returned' : c.expected_return < today ? 'overdue' : 'active',
          other: otherUser
            ? {
                name: otherUser.name,
                email: otherUser.email,
                phone: otherUser.phone,
                hostel: otherUser.hostel,
              }
            : { name: 'Campus Member', email: '', phone: '', hostel: '' },
        };
      })
    );

    hydrated.sort((a, b) => {
      const aRet = a.returned_at ? 1 : 0;
      const bRet = b.returned_at ? 1 : 0;
      if (aRet !== bRet) return aRet - bRet;
      return a.expected_return.localeCompare(b.expected_return);
    });

    if (statusFilter === 'active') return hydrated.filter((c) => c.status !== 'returned');
    if (statusFilter === 'returned') return hydrated.filter((c) => c.status === 'returned');
    return hydrated;
  },
};

/* ---------- Senior Inventory Repository ---------- */
const inventory = {
  async hydrateItem(raw, viewer) {
    if (!raw) return null;
    const item = normalizeDoc(raw);
    const senior = await users.findById(item.senior_id);
    const viewerId = viewer ? String(viewer.id) : null;
    return {
      id: String(item.id),
      component: item.component,
      category: item.category || 'Microcontrollers',
      quantity: item.quantity,
      condition: item.condition || 'Good',
      share_type: item.share_type || 'lend',
      rent_amount: item.rent_amount ?? null,
      description: item.description || null,
      available: Boolean(item.available),
      created_at: item.created_at,
      is_mine: Boolean(viewerId && String(item.senior_id) === viewerId),
      senior: senior
        ? {
            id: String(senior.id),
            name: senior.name,
            branch: senior.branch,
            year: senior.year,
            hostel: senior.hostel,
            reputation: senior.reputation || 0,
          }
        : { id: String(item.senior_id), name: 'Senior Member', branch: null, year: null },
    };
  },

  async list({ q = '', category = '', availableOnly = true, mine = false } = {}, viewer) {
    await connect();
    let docs;
    if (mode === 'mongodb') {
      const filter = {};
      if (availableOnly && !mine) filter.available = true;
      if (category && category !== 'all') filter.category = category;
      if (mine && viewer) filter.senior_id = String(viewer.id);
      if (q) {
        const regex = new RegExp(String(q).trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter.$or = [{ component: regex }, { description: regex }, { category: regex }];
      }
      docs = await models.Inventory.find(filter).sort({ created_at: -1 }).limit(100);
    } else {
      docs = [...store.inventory];
      if (availableOnly && !mine) docs = docs.filter((i) => i.available);
      if (category && category !== 'all') docs = docs.filter((i) => (i.category || 'Microcontrollers') === category);
      if (mine && viewer) docs = docs.filter((i) => String(i.senior_id) === String(viewer.id));
      if (q) {
        const needle = String(q).trim().toLowerCase().slice(0, 60);
        docs = docs.filter(
          (i) =>
            (i.component && i.component.toLowerCase().includes(needle)) ||
            (i.description && i.description.toLowerCase().includes(needle)) ||
            (i.category && i.category.toLowerCase().includes(needle))
        );
      }
      docs.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
      docs = docs.slice(0, 100);
    }
    return Promise.all(docs.map((d) => this.hydrateItem(d, viewer)));
  },

  async create(seniorUser, data) {
    await connect();
    const payload = {
      senior_id: String(seniorUser.id),
      component: data.component,
      category: data.category || 'Microcontrollers',
      quantity: data.quantity,
      condition: data.condition || 'Good',
      share_type: data.share_type || 'lend',
      rent_amount: data.rent_amount ?? null,
      description: data.description || null,
      available: true,
      created_at: nowIso(),
    };
    let raw;
    if (mode === 'mongodb') {
      raw = await models.Inventory.create(payload);
    } else {
      raw = { id: genId(), ...payload };
      store.inventory.push(raw);
      saveStore();
    }
    await users.addReputation(seniorUser.id, 5);
    return this.hydrateItem(raw, seniorUser);
  },

  async toggleAvailable(id, seniorUser) {
    await connect();
    const seniorId = String(seniorUser.id);
    let raw;
    if (mode === 'mongodb') {
      if (!mongoose.Types.ObjectId.isValid(id)) return null;
      const item = await models.Inventory.findOne({ _id: id, senior_id: seniorId });
      if (!item) return null;
      item.available = !item.available;
      await item.save();
      raw = item;
    } else {
      const item = store.inventory.find((i) => String(i.id) === String(id) && String(i.senior_id) === seniorId);
      if (!item) return null;
      item.available = !item.available;
      saveStore();
      raw = item;
    }
    return this.hydrateItem(raw, seniorUser);
  },

  async remove(id, seniorUser) {
    await connect();
    const seniorId = String(seniorUser.id);
    if (mode === 'mongodb') {
      if (!mongoose.Types.ObjectId.isValid(id)) return false;
      const res = await models.Inventory.deleteOne({ _id: id, senior_id: seniorId });
      return res.deletedCount > 0;
    }
    const idx = store.inventory.findIndex((i) => String(i.id) === String(id) && String(i.senior_id) === seniorId);
    if (idx === -1) return false;
    store.inventory.splice(idx, 1);
    saveStore();
    return true;
  },
};

/* ---------- Comments Repository ---------- */
const comments = {
  async listForRequest(requestId) {
    await connect();
    let docs;
    if (mode === 'mongodb') {
      docs = await models.Comment.find({ request_id: String(requestId) }).sort({ created_at: 1 });
    } else {
      docs = store.comments
        .filter((c) => String(c.request_id) === String(requestId))
        .sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
    }
    return Promise.all(
      docs.map(async (d) => {
        const c = normalizeDoc(d);
        const author = await users.findById(c.user_id);
        return {
          id: String(c.id),
          request_id: String(c.request_id),
          body: c.body,
          created_at: c.created_at,
          author: author
            ? { id: String(author.id), name: author.name, role: author.role, branch: author.branch, year: author.year }
            : { id: String(c.user_id), name: 'Member', role: 'junior' },
        };
      })
    );
  },

  async create(requestId, user, body) {
    await connect();
    const payload = {
      request_id: String(requestId),
      user_id: String(user.id),
      body,
      created_at: nowIso(),
    };
    let raw;
    if (mode === 'mongodb') {
      raw = await models.Comment.create(payload);
    } else {
      raw = { id: genId(), ...payload };
      store.comments.push(raw);
      saveStore();
    }

    // Notify the other party on the request
    const reqItem = await requests.findById(requestId, user);
    if (reqItem) {
      const recipientId =
        String(reqItem.junior.id) === String(user.id)
          ? reqItem.senior && reqItem.senior.id
          : reqItem.junior.id;
      if (recipientId && String(recipientId) !== String(user.id)) {
        await notifications.create(
          recipientId,
          `${user.name} commented on "${reqItem.title}": "${body.slice(0, 60)}"`,
          `#/request/${requestId}`
        );
      }
    }

    const c = normalizeDoc(raw);
    return {
      id: String(c.id),
      request_id: String(c.request_id),
      body: c.body,
      created_at: c.created_at,
      author: {
        id: String(user.id),
        name: user.name,
        role: user.role,
        branch: user.branch,
        year: user.year,
      },
    };
  },
};

/* ---------- Stats Repository ---------- */
const stats = {
  async getPublicStats() {
    await connect();
    const today = v.today();

    if (mode === 'mongodb') {
      const [openReqs, activeCos, overdueCos, totalCos, memberCount, availableInv, allReqs, topSeniors] =
        await Promise.all([
          models.Request.countDocuments({ status: 'open' }),
          models.Checkout.countDocuments({ returned_at: null }),
          models.Checkout.countDocuments({ returned_at: null, expected_return: { $lt: today } }),
          models.Checkout.countDocuments(),
          models.User.countDocuments(),
          models.Inventory.countDocuments({ available: true }),
          models.Request.find({}, { component: 1 }),
          models.User.find({ role: 'senior' }).sort({ reputation: -1 }).limit(5),
        ]);

      const counts = {};
      for (const r of allReqs) {
        const key = String(r.component || '').trim().toLowerCase();
        if (key) counts[key] = (counts[key] || 0) + 1;
      }
      const most_requested = Object.entries(counts)
        .map(([component, requests]) => ({ component, requests }))
        .sort((a, b) => b.requests - a.requests)
        .slice(0, 5);

      return {
        open_requests: openReqs,
        active_checkouts: activeCos,
        overdue_checkouts: overdueCos,
        items_recirculated: totalCos,
        available_inventory: availableInv,
        members: memberCount,
        most_requested,
        top_lenders: topSeniors.map((s) => ({
          name: s.name,
          branch: s.branch,
          year: s.year,
          hostel: s.hostel,
          reputation: s.reputation || 0,
        })),
        campus: config.CAMPUS_NAME,
        db_engine: connectionInfo.engine,
      };
    }

    const open_requests = store.requests.filter((r) => r.status === 'open').length;
    const active_checkouts = store.checkouts.filter((c) => !c.returned_at).length;
    const overdue_checkouts = store.checkouts.filter((c) => !c.returned_at && c.expected_return < today).length;
    const items_recirculated = store.checkouts.length;
    const available_inventory = store.inventory.filter((i) => i.available).length;
    const members = store.users.length;

    const counts = {};
    for (const r of store.requests) {
      const key = String(r.component || '').trim().toLowerCase();
      if (key) counts[key] = (counts[key] || 0) + 1;
    }
    const most_requested = Object.entries(counts)
      .map(([component, requests]) => ({ component, requests }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 5);

    const top_lenders = store.users
      .filter((u) => u.role === 'senior')
      .sort((a, b) => (b.reputation || 0) - (a.reputation || 0))
      .slice(0, 5)
      .map((s) => ({
        name: s.name,
        branch: s.branch,
        year: s.year,
        hostel: s.hostel,
        reputation: s.reputation || 0,
      }));

    return {
      open_requests,
      active_checkouts,
      overdue_checkouts,
      items_recirculated,
      available_inventory,
      members,
      most_requested,
      top_lenders,
      campus: config.CAMPUS_NAME,
      db_engine: connectionInfo.engine,
    };
  },
};

/* ---------- Seed Demo Data (IIT Roorkee) ---------- */
async function seedDemoData({ force = false } = {}) {
  await connect();
  const existingCount = await users.count();
  if (existingCount > 0 && !force) {
    return { seeded: false, reason: 'already_populated', users: existingCount };
  }

  const hash = hashPassword('demo1234');
  const daysFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  const junior1 = await users.create({
    name: 'Riya Sharma',
    email: 'riya@ece.iitr.ac.in',
    password_hash: hash,
    role: 'junior',
    enrollment_no: '25116042',
    branch: 'ECE',
    year: 1,
    phone: '9876500001',
    hostel: 'Kasturba Bhawan, B-214',
    bio: 'First-year robotics enthusiast working on MARS & Robocon club projects.',
    reputation: 5,
  });

  const junior2 = await users.create({
    name: 'Aman Verma',
    email: 'aman@cs.iitr.ac.in',
    password_hash: hash,
    role: 'junior',
    enrollment_no: '24114018',
    branch: 'CSE',
    year: 2,
    phone: '9876500002',
    hostel: 'Cautley Bhawan, G-118',
    bio: 'Building embedded IoT nodes and edge vision prototypes.',
    reputation: 10,
  });

  const senior1 = await users.create({
    name: 'Karan Mehta',
    email: 'karan@ece.iitr.ac.in',
    password_hash: hash,
    role: 'senior',
    enrollment_no: '22116009',
    branch: 'ECE',
    year: 4,
    phone: '9876500003',
    hostel: 'Rajendra Bhawan, F-305',
    bio: 'Final-year ECE student with a drawer full of STM32s, ESP32s, and sensors from past Shrishti projects.',
    reputation: 45,
  });

  const senior2 = await users.create({
    name: 'Neha Gupta',
    email: 'neha@ee.iitr.ac.in',
    password_hash: hash,
    role: 'senior',
    enrollment_no: '23115031',
    branch: 'EE',
    year: 3,
    phone: '9876500004',
    hostel: 'Sarojini Bhawan, A-410',
    bio: 'Power electronics & motor control lead. Happy to lend drivers, LiPo chargers, and multimeters.',
    reputation: 30,
  });

  // Also create quick alias demo logins on @iitr.ac.in
  await users.create({
    name: 'Aarav Joshi (Demo Junior)',
    email: 'junior@iitr.ac.in',
    password_hash: hash,
    role: 'junior',
    enrollment_no: '25114088',
    branch: 'ECE',
    year: 1,
    phone: '9876500005',
    hostel: 'Govind Bhawan, C-102',
    bio: '1st year student exploring embedded systems.',
    reputation: 0,
  });

  await users.create({
    name: 'Udit Bhatt (Demo Senior)',
    email: 'senior@iitr.ac.in',
    password_hash: hash,
    role: 'senior',
    enrollment_no: '22114001',
    branch: 'CSE',
    year: 4,
    phone: '9876500006',
    hostel: 'Radhakrishnan Bhawan, D-208',
    bio: 'Senior mentor sharing FPGA boards, Raspberry Pis, and robotics sensors.',
    reputation: 50,
  });

  // Seed Requests
  const req1 = await requests.create(
    {
      title: 'Arduino Uno R3 for Shrishti line-follower bot',
      component: 'Arduino Uno R3',
      category: 'Microcontrollers',
      quantity: 1,
      project_scope:
        'First-year Tinkering Lab & Shrishti robotics project: a PID line-follower using an 8-array IR sensor bar. Need the board + USB-B cable for 3 weeks.',
      needed_from: daysFromNow(1),
      needed_until: daysFromNow(21),
    },
    junior1
  );

  await comments.create(
    req1.id,
    senior1,
    'Hey Riya! I have an SMD Arduino Uno R3 with header pins soldered and a long USB cable at Rajendra Bhawan. Let me know if you still need it!'
  );

  await requests.create(
    {
      title: 'HC-SR04 Ultrasonic Sensors (Pair)',
      component: 'HC-SR04 Ultrasonic Sensor',
      category: 'Sensors',
      quantity: 2,
      project_scope:
        'Obstacle avoidance module for the same autonomous bot. Any working 5V pair with mounting brackets would be awesome.',
      needed_from: daysFromNow(1),
      needed_until: daysFromNow(21),
    },
    junior1
  );

  await requests.create(
    {
      title: 'ESP32-WROOM DevKit for Campus Weather Node',
      component: 'ESP32 DevKit V1',
      category: 'Microcontrollers',
      quantity: 1,
      project_scope:
        'Building a low-power Wi-Fi + MQTT temperature/humidity logger for our CEN-204 course project. Would love quick tips on deep sleep current draw.',
      needed_from: daysFromNow(2),
      needed_until: daysFromNow(28),
    },
    junior2
  );

  await requests.create(
    {
      title: 'Raspberry Pi 4 (4GB) for Edge CV Demo',
      component: 'Raspberry Pi 4 Model B',
      category: 'Single-Board Computers',
      quantity: 1,
      project_scope:
        'Running YOLOv8-nano inference on live camera frames for our departmental exhibition next week. Power adapter + microSD preferred.',
      needed_from: daysFromNow(3),
      needed_until: daysFromNow(12),
    },
    junior2
  );

  // One request claimed and handed over (active checkout)
  const inflight = await requests.create(
    {
      title: 'L298N Dual H-Bridge + Breadboard Kit',
      component: 'L298N Motor Driver & Breadboard',
      category: 'Power & Motors',
      quantity: 2,
      project_scope: 'Testing closed-loop DC gear motor speed control with optical encoders for our mechatronics lab.',
      needed_from: daysFromNow(-3),
      needed_until: daysFromNow(10),
    },
    junior2
  );

  await requests.claim(inflight.id, senior1, {
    claim_type: 'lend',
    rent_amount: null,
    claim_note: 'Happy to lend both L298N modules and a 830-tie breadboard. Meet near Nesci at 6 PM!',
  });

  await requests.handover(inflight.id, senior1, {
    expected_return: daysFromNow(7),
    condition_note: 'Tested both channels; jumper caps attached.',
  });

  // Seed Senior Available Inventory Catalog
  await inventory.create(senior1, {
    component: 'STM32F401RE Nucleo-64 Board',
    category: 'Microcontrollers',
    quantity: 1,
    condition: 'New',
    share_type: 'lend',
    rent_amount: null,
    description: 'Unused Nucleo-64 with onboard ST-LINK/V2-1 debugger. Great for ARM Cortex-M4 coursework.',
  });

  await inventory.create(senior1, {
    component: 'MPU-6050 6-DOF IMU Gyro + Accelerometer',
    category: 'Sensors',
    quantity: 3,
    condition: 'Good',
    share_type: 'lend',
    rent_amount: null,
    description: 'Pre-soldered 90-degree pin headers. Ideal for self-balancing bots or drone flight controllers.',
  });

  await inventory.create(senior2, {
    component: 'Saleae 8-Channel 24MHz USB Logic Analyzer',
    category: 'Tools & Prototyping',
    quantity: 1,
    condition: 'Good',
    share_type: 'lend',
    rent_amount: null,
    description: 'Comes with 10female-to-female test clips and USB cable for debugging SPI, I2C, and UART.',
  });

  await inventory.create(senior2, {
    component: 'Raspberry Pi Zero 2 W + Pi Camera v2',
    category: 'Single-Board Computers',
    quantity: 1,
    condition: 'Good',
    share_type: 'rent',
    rent_amount: 100,
    description: 'Includes 32GB SanDisk Extreme microSD, mini-HDMI adapter, and ribbon camera module.',
  });

  return { seeded: true, users: 6 };
}

async function resetForTests() {
  mode = 'json-store';
  store = {
    users: [],
    requests: [],
    checkouts: [],
    inventory: [],
    comments: [],
    notifications: [],
  };
  connectionInfo = {
    engine: 'memory-document-store',
    connected: true,
    uri_type: 'memory',
  };
}

module.exports = {
  connect,
  getHealth: () => connectionInfo,
  users,
  requests,
  checkouts,
  inventory,
  comments,
  notifications,
  stats,
  seedDemoData,
  resetForTests,
};
