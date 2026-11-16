// Mailer interface for the PM Store reports engine. Two implementations;
// which one is active is picked by reportService from REPORT_MAILER env var.

// Default — never sends anything. Writes the generated workbook(s) to /tmp
// and logs what *would* have been sent, so reports/scheduler can be exercised
// end-to-end before real delivery is wired up.
class LogMailer {
  async send({ to, cc, subject, html, attachments }) {
    const fs = require('fs');
    const paths = (attachments || []).map((a) => {
      const p = `/tmp/${a.filename}`;
      fs.writeFileSync(p, a.buffer);
      return p;
    });
    console.log('[LogMailer] would send:', JSON.stringify({ to, cc, subject, attachments: paths }));
    console.log('[LogMailer] html body:\n', html);
    return { sent: false, mailer: 'LogMailer', attachmentPaths: paths };
  }
}

// TODO: delivery mechanism not decided yet — user will supply the internal
// workflow/tool endpoint + payload shape once chosen. Do not implement
// against the invite-email workflow-engine integration (server/lib/mailer.js)
// without explicit confirmation it's the same channel for multi-recipient,
// multi-attachment report mail.
class WorkflowMailer {
  async send({ to, cc, subject, html, attachments }) {
    throw new Error('WorkflowMailer not implemented yet — endpoint/payload pending.');
  }
}

module.exports = { LogMailer, WorkflowMailer };
