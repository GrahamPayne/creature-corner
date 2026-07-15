// Cloudflare Pages Function: POST /api/commission-inquiry
// Validates the commission form payload and sends it via the Resend API.
// RESEND_API_KEY (and optionally CONTACT_TO_EMAIL / MAIL_FROM) must be set as
// Cloudflare Pages environment variables/secrets — never hardcode the key here.

export async function onRequestPost({ request, env }) {
    let body;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ ok: false, error: 'Invalid request body.' }, 400);
    }

    // Honeypot: bots that fill in this hidden field get a fake success, no email sent.
    if (body.company) {
        return jsonResponse({ ok: true });
    }

    const name = (body.name || '').trim();
    const email = (body.email || '').trim();
    const description = (body.description || '').trim();
    const budget = (body.budget || '').trim();
    const timeline = (body.timeline || '').trim();
    const references = (body.references || '').trim();
    const agreeTerms = body.agreeTerms === true;

    if (!name || !email || !description || !agreeTerms) {
        return jsonResponse({ ok: false, error: 'Missing required fields.' }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return jsonResponse({ ok: false, error: 'Invalid email address.' }, 400);
    }

    if (!env.RESEND_API_KEY) {
        return jsonResponse({ ok: false, error: 'Email service is not configured.' }, 500);
    }

    const to = env.CONTACT_TO_EMAIL || 'creaturecornerart@gmail.com';
    const from = env.MAIL_FROM || 'Creature Corner Commissions <commissions@creaturecorner.art>';

    const bodyLines = [
        `Name: ${name}`,
        `Email: ${email}`,
        budget ? `Budget: ${budget}` : null,
        timeline ? `Timeline: ${timeline}` : null,
        references ? `References: ${references}` : null,
        '',
        'Description:',
        description
    ].filter((line) => line !== null).join('\n');

    try {
        const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${env.RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from,
                to: [to],
                reply_to: email,
                subject: `New commission inquiry from ${name}`,
                text: bodyLines
            })
        });

        if (!emailRes.ok) {
            return jsonResponse({ ok: false, error: 'Email service error.' }, 502);
        }

        return jsonResponse({ ok: true });
    } catch {
        return jsonResponse({ ok: false, error: 'Server error.' }, 500);
    }
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
