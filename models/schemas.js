// Mongoose schemas and models for MongoDB Atlas / local MongoDB
function createModels(mongoose) {
  const { Schema } = mongoose;

  const userSchema = new Schema({
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    password_hash: { type: String, required: true },
    role: { type: String, required: true, enum: ['junior', 'senior'], index: true },
    enrollment_no: { type: String, default: null, trim: true, maxlength: 20 },
    branch: { type: String, default: null, trim: true, maxlength: 60 },
    year: { type: Number, default: null, min: 1, max: 6 },
    phone: { type: String, default: null, trim: true, maxlength: 20 },
    hostel: { type: String, default: null, trim: true, maxlength: 80 },
    bio: { type: String, default: null, trim: true, maxlength: 300 },
    reputation: { type: Number, default: 0 },
    created_at: { type: String, default: () => new Date().toISOString() },
  });

  const requestSchema = new Schema({
    junior_id: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true, minlength: 4, maxlength: 120 },
    component: { type: String, required: true, trim: true, minlength: 2, maxlength: 100, index: true },
    category: { type: String, default: 'Microcontrollers', index: true },
    quantity: { type: Number, required: true, default: 1, min: 1, max: 50 },
    project_scope: { type: String, required: true, trim: true, minlength: 10, maxlength: 1000 },
    needed_from: { type: String, required: true },
    needed_until: { type: String, required: true },
    status: {
      type: String,
      required: true,
      default: 'open',
      enum: ['open', 'claimed', 'checked_out', 'returned', 'cancelled'],
      index: true,
    },
    claimed_by: { type: String, default: null, index: true },
    claim_type: { type: String, default: null, enum: [null, 'lend', 'rent'] },
    rent_amount: { type: Number, default: null },
    claim_note: { type: String, default: null, maxlength: 500 },
    claimed_at: { type: String, default: null },
    inventory_id: { type: String, default: null },
    created_at: { type: String, default: () => new Date().toISOString(), index: true },
  });

  const checkoutSchema = new Schema({
    request_id: { type: String, required: true, unique: true, index: true },
    lender_id: { type: String, required: true, index: true },
    borrower_id: { type: String, required: true, index: true },
    handed_over_at: { type: String, default: () => new Date().toISOString() },
    expected_return: { type: String, required: true },
    returned_at: { type: String, default: null },
    condition_note: { type: String, default: null, maxlength: 300 },
    borrower_confirmed: { type: Boolean, default: false },
  });

  const inventorySchema = new Schema({
    senior_id: { type: String, required: true, index: true },
    component: { type: String, required: true, trim: true, minlength: 2, maxlength: 100, index: true },
    category: { type: String, default: 'Microcontrollers', index: true },
    quantity: { type: Number, required: true, default: 1, min: 1, max: 50 },
    condition: { type: String, default: 'Good', enum: ['New', 'Good', 'Fair'] },
    share_type: { type: String, default: 'lend', enum: ['lend', 'rent', 'both'] },
    rent_amount: { type: Number, default: null },
    description: { type: String, default: null, maxlength: 500 },
    available: { type: Boolean, default: true, index: true },
    created_at: { type: String, default: () => new Date().toISOString() },
  });

  const commentSchema = new Schema({
    request_id: { type: String, required: true, index: true },
    user_id: { type: String, required: true },
    body: { type: String, required: true, trim: true, minlength: 1, maxlength: 500 },
    created_at: { type: String, default: () => new Date().toISOString() },
  });

  const notificationSchema = new Schema({
    user_id: { type: String, required: true, index: true },
    message: { type: String, required: true },
    link: { type: String, default: '#/' },
    read: { type: Boolean, default: false, index: true },
    created_at: { type: String, default: () => new Date().toISOString() },
  });

  const User = mongoose.models.User || mongoose.model('User', userSchema);
  const Request = mongoose.models.Request || mongoose.model('Request', requestSchema);
  const Checkout = mongoose.models.Checkout || mongoose.model('Checkout', checkoutSchema);
  const Inventory = mongoose.models.Inventory || mongoose.model('Inventory', inventorySchema);
  const Comment = mongoose.models.Comment || mongoose.model('Comment', commentSchema);
  const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);

  return { User, Request, Checkout, Inventory, Comment, Notification };
}

module.exports = { createModels };
