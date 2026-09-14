export default function handler(req, res) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.PATREON_CLIENT_ID,
    redirect_uri: `https://promt-iiu6ooofm-iaventassc-5344.vercel.app/api/auth/callback`,
    scope: 'identity identity[email] identity.memberships',
  });
  res.redirect(`https://www.patreon.com/oauth2/authorize?${params}`);
}
