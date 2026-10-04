import logging
import os
import smtplib
import time
from email.message import EmailMessage
import httpx
from app.common import pool

logging.basicConfig(level=logging.INFO)
log = logging.getLogger('notifications')

def cycle():
    base = os.getenv('CIRCULATION_URL', 'http://circulation:8000')
    headers = {'X-Internal-Token': os.environ['INTERNAL_TOKEN']}
    with httpx.Client(timeout=15, headers=headers) as client:
        client.post(base + '/internal/tick').raise_for_status()
        r = client.get(base + '/internal/events')
        r.raise_for_status()
        for e in r.json():
            with pool.connection() as c:
                c.execute('INSERT INTO messages(event_key,email,subject,body) VALUES(%s,%s,%s,%s) ON CONFLICT(event_key) DO NOTHING', (e['event_key'], e['email'], e['subject'], e['body']))
            client.post(base + f"/internal/events/{e['id']}/ack").raise_for_status()
    # Row locks allow multiple workers. SMTP delivery is at-least-once:
    # a crash after SMTP accepts the mail but before COMMIT can cause a duplicate.
    for _ in range(100):
        with pool.connection() as c:
            m = c.execute('SELECT * FROM messages WHERE sent_at IS NULL AND next_attempt<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1').fetchone()
            if not m:
                break
            try:
                email = EmailMessage()
                email['From'] = os.getenv('SMTP_FROM', 'library@example.test')
                email['To'] = m['email']
                email['Subject'] = m['subject']
                email['Message-ID'] = f"<library-{m['id']}@notifications.local>"
                email.set_content(m['body'])
                with smtplib.SMTP(os.getenv('SMTP_HOST', 'mailpit'), int(os.getenv('SMTP_PORT', '1025')), timeout=10) as smtp:
                    if os.getenv('SMTP_TLS', 'false').lower() == 'true':
                        smtp.starttls()
                    if os.getenv('SMTP_USER'):
                        smtp.login(os.environ['SMTP_USER'], os.environ['SMTP_PASSWORD'])
                    smtp.send_message(email)
                c.execute('UPDATE messages SET sent_at=now(),last_error=NULL WHERE id=%s', (m['id'],))
            except (OSError, smtplib.SMTPException) as exc:
                log.warning('SMTP failed for message %s: %s', m['id'], type(exc).__name__)
                c.execute("UPDATE messages SET attempts=attempts+1,next_attempt=now()+(%s * interval '1 second'),last_error=%s WHERE id=%s", (min(3600, 30 * 2 ** min(m['attempts'], 7)), type(exc).__name__, m['id']))

if __name__ == '__main__':
    pool.open(wait=True)
    while True:
        try:
            cycle()
        except Exception:
            log.exception('Notification cycle failed; retrying')
        time.sleep(int(os.getenv('POLL_SECONDS', '30')))
