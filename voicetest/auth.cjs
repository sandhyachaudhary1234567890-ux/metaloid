// Test-only auth seeding for voicetest harnesses (NEVER ships to the app).
// The gateway is multi-user now: harnesses sign up a throwaway user,
// complete onboarding via API, and seed the browser session before page
// load — exactly like a real user, minus the clicks.
async function seedTestAuth(GW, tag = 'vt') {
  const handle = `${tag}${Date.now().toString(36)}`.slice(0, 30);
  const signup = await fetch(`${GW}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle, displayName: 'Voice Test', passcode: 'test-voice-1234' }),
  }).then((r) => r.json());
  if (!signup.access) throw new Error('seed signup failed: ' + JSON.stringify(signup).slice(0, 160));
  await fetch(`${GW}/api/onboarding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + signup.access },
    body: JSON.stringify({ displayName: 'Voice Test', language: 'en', verbosity: 'brief', autonomy: 'assisted' }),
  });
  const session = { access: signup.access, refresh: signup.refresh, user: signup.user };
  return { handle, token: signup.access, session };
}

/** Seeded localStorage snippet for puppeteer evaluateOnNewDocument. */
function seedSnippet(session) {
  const raw = JSON.stringify(session);
  return `try{localStorage.setItem('metaloid.session.v1',${JSON.stringify(raw)})}catch(e){}`;
}

module.exports = { seedTestAuth, seedSnippet };
