// routes/logs.js - POST /api/logs  (centralized error logging)
// When something unexpected breaks in the browser, the page sends a short report here.
// So the developer sees problems from every user in ONE place (the server log + the admin endpoint).
// Big companies use tools like Sentry for this; this is the same idea in a tiny version.
const express = require('express');
const { sendError, requireJson } = require('../middleware');

const router = express.Router();
const recent = []; // the last 50 reports (in memory)
const MAX_KEPT = 50;

router.post('/', requireJson, (req, res) => {
  const body = req.body || {};
  if (typeof body.message !== 'string' || !body.message.trim()) {
    return sendError(res, 422, 'VALIDATION_ERROR', 'Invalid log entry', [
      { field: 'message', message: 'message is required' },
    ]);
  }
  const entry = {
    time: new Date().toISOString(),
    message: body.message.slice(0, 300),
    context: typeof body.context === 'string' ? body.context.slice(0, 60) : '',
    status: Number.isInteger(body.status) ? body.status : 0,
    page: typeof body.page === 'string' ? body.page.slice(0, 100) : '',
    userAgent: String(req.get('user-agent') || '').slice(0, 150),
  };
  recent.unshift(entry);
  if (recent.length > MAX_KEPT) recent.pop();
  if (process.env.SILENT !== '1') console.error('[client-error]', JSON.stringify(entry));
  res.status(202).json({ success: true }); // 202 = got it, thanks
});

module.exports = { router, recent };
