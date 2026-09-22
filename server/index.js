require('dotenv').config();

// Safety net: an unhandled promise rejection anywhere (a flaky WhatsApp socket call, a stray
// fire-and-forget notification, etc.) would otherwise crash the entire process and take the whole
// app offline for every member/admin until it's manually restarted. Log it and keep running.
process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection (process kept alive):', err);
});

const path = require('path');
const express = require('express');
const cors = require('cors');

const db = require('./db'); // ensures schema + seed admin exist (async - see db.ready below)

const authRoutes = require('./routes/auth.routes');
const memberRoutes = require('./routes/members.routes');
const coreMemberRoutes = require('./routes/coreMembers.routes');
const eventRoutes = require('./routes/events.routes');
const expenseRoutes = require('./routes/expenses.routes');
const maintenanceRoutes = require('./routes/maintenance.routes');
const donationRoutes = require('./routes/donations.routes');
const userRoutes = require('./routes/users.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const paymentSettingsRoutes = require('./routes/paymentSettings.routes');
const razorpayPaymentsRoutes = require('./routes/razorpayPayments.routes');
const pettyCashRoutes = require('./routes/pettyCash.routes');
const publicDonationsRoutes = require('./routes/publicDonations.routes');
const noticeRoutes = require('./routes/notices.routes');
const contactMessageRoutes = require('./routes/contactMessages.routes');
const publicSiteRoutes = require('./routes/publicSite.routes');
const publicMaintenanceRoutes = require('./routes/publicMaintenance.routes');
const generalSettingsRoutes = require('./routes/generalSettings.routes');
const whatsappRoutes = require('./routes/whatsapp.routes');
const activityLogRoutes = require('./routes/activityLog.routes');
const reportsRoutes = require('./routes/reports.routes');
const { sendDailyReminders } = require('./utils/maintenanceReminders');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' })); // raised to fit base64 committee-photo uploads

app.use('/api/auth', authRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/core-members', coreMemberRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/donations', donationRoutes);
app.use('/api/users', userRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/payment-settings', paymentSettingsRoutes);
app.use('/api/payments/razorpay', razorpayPaymentsRoutes);
app.use('/api/petty-cash', pettyCashRoutes);
app.use('/api/public/donations', publicDonationsRoutes);
app.use('/api/notices', noticeRoutes);
app.use('/api/contact-messages', contactMessageRoutes);
app.use('/api/public/site', publicSiteRoutes);
app.use('/api/public/maintenance', publicMaintenanceRoutes);
app.use('/api/general-settings', generalSettingsRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/activity-log', activityLogRoutes);
app.use('/api/reports', reportsRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/donate', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'donate.html'));
});

app.get('/pay-monthly-maintenance', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'pay-maintenance.html'));
});

// The member/admin portal (hash-routed SPA) lives at /portal; "/" is the public marketing site
app.get('/portal', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'portal.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// sendDailyReminders() is idempotent (guards on general_settings.reminders_last_sent_date), so a
// frequent check is safe - no cron dependency needed, and it self-heals if the server restarts.
// Checked every 5 minutes so the admin-configured reminder_time is honored fairly closely.
async function checkDailyReminders() {
  try {
    const result = await sendDailyReminders();
    if (!result.skipped) {
      console.log(`Maintenance reminders (${result.dateKey}): sent ${result.sent.length}/${result.totalDue}, ${result.failed.length} failed, ${result.skippedNoPhone.length} skipped (no phone)`);
    }
  } catch (err) {
    console.error('Daily reminder check failed:', err.message);
  }
}

// Wait for the MySQL schema/seed setup (server/db.js) to finish before accepting any request -
// a request that raced ahead of table creation would just fail with "table doesn't exist".
db.ready
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Sri Balamurugan Nagar Welfare Association app running at http://localhost:${PORT}`);
    });
    setInterval(checkDailyReminders, 5 * 60 * 1000);
    checkDailyReminders();
  })
  .catch((err) => {
    console.error('Database setup failed, not starting server:', err);
    process.exit(1);
  });
