import { api } from '../api.js';
import { brandMark } from '../brand.js';
import { esc, formData, withLoading } from '../ui.js';

function shell(title, subtitle, body, foot = '') {
  return `
    <div class="auth">
      <div class="auth__card"><a class="portal-auth-back" href="/">← Back to LIFEGEN</a>
        <div class="auth__brand">
          <span class="brand__mark">${brandMark}</span>
          <div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>
        </div>
        <div class="card"><div class="card__body">${body}</div></div>
        <p class="auth__foot">LIFEGEN Admin${foot} · <a href="#/privacy">Privacy &amp; Terms</a></p>
      </div>
    </div>`;
}

export function renderLogin(root, onSuccess) {
  const recoveryAvailable=root.dataset.recovery==='true';
  root.innerHTML = shell('LIFEGEN Admin', 'People, VIP registrations, calendar and attendance', `
    <form id="loginForm" class="stack" novalidate>
      ${root.dataset.demo === "true" ? '<div class="alert alert--info small">Local demo only: <b>demo@lifegen.local</b> / <b>LifegenDemo2026!</b></div>' : ""}
      <div id="loginError" class="alert alert--error" hidden></div>
      <div id="recoveryNotice" class="alert alert--success" hidden></div>
      <div class="field"><label for="u">Username</label><input id="u" name="username" autocomplete="username" required autofocus /></div>
      <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required /></div>
      <button class="btn btn--primary btn--lg btn--block" type="submit">Sign in</button>
      ${recoveryAvailable?'<button class="btn btn--sm" type="button" id="showRecovery">Forgot admin password?</button>':''}
    </form>
    ${recoveryAvailable?`<form id="recoveryForm" class="stack" novalidate hidden>
      <div class="alert alert--info small">Resetting the admin password requires your private setup/recovery code. This will sign out all existing sessions.</div>
      <div id="recoveryError" class="alert alert--error" hidden></div>
      <div id="recoverySuccess" class="alert alert--success" hidden></div>
      <div class="field"><label for="recoveryCode">Private setup/recovery code</label><input id="recoveryCode" name="setup_key" type="password" autocomplete="off" required /></div>
      <div class="field"><label for="recoveryUsername">Admin username</label><input id="recoveryUsername" name="username" autocomplete="username" required /></div>
      <div class="field"><label for="recoveryPassword">New password</label><input id="recoveryPassword" name="password" type="password" autocomplete="new-password" minlength="12" required /><span class="help">At least 12 characters.</span></div>
      <div class="field"><label for="recoveryConfirm">Confirm new password</label><input id="recoveryConfirm" name="confirm" type="password" autocomplete="new-password" minlength="12" required /></div>
      <button class="btn btn--primary btn--lg btn--block" type="submit">Reset admin password</button>
      <button class="btn btn--sm" type="button" id="cancelRecovery">Back to sign in</button>
    </form>`:''}`);
  const form = root.querySelector('#loginForm');
  const errBox = root.querySelector('#loginError');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const { username, password } = formData(form);
    errBox.hidden = true;
    if (!username || !password) { errBox.textContent = 'Please enter your username and password.'; errBox.hidden = false; return; }
    await withLoading(form.querySelector('button[type="submit"]'), async () => {
      try {
        const { user } = await api.login(username, password);
        const ready=await onSuccess(user);
        if(ready===false){errBox.textContent='Your credentials were accepted, but the preview session could not be verified. Your account is okay; please contact support with this exact message.';errBox.hidden=false;}
      } catch (err) {
        errBox.textContent = err.message;
        errBox.hidden = false;
      }
    });
  };
  if(recoveryAvailable){
    const recovery=root.querySelector('#recoveryForm'),recoveryError=root.querySelector('#recoveryError'),success=root.querySelector('#recoverySuccess');
    root.querySelector('#showRecovery').onclick=()=>{recovery.hidden=false;form.hidden=true;root.querySelector('#recoveryNotice').hidden=true;root.querySelector('#recoveryUsername').value=root.querySelector('#u').value;root.querySelector('#recoveryCode').focus();};
    root.querySelector('#cancelRecovery').onclick=()=>{recovery.hidden=true;form.hidden=false;};
    recovery.onsubmit=async e=>{e.preventDefault();recoveryError.hidden=true;success.hidden=true;const d=formData(recovery);if(d.password!==d.confirm){recoveryError.textContent='The new passwords do not match.';recoveryError.hidden=false;return;}await withLoading(recovery.querySelector('button[type="submit"]'),async()=>{try{await api.recoverAdmin({setup_key:d.setup_key,username:d.username,password:d.password});success.textContent='Admin password reset.';success.hidden=false;root.querySelector('#recoveryNotice').textContent='Admin password reset. Sign in with your new password.';root.querySelector('#recoveryNotice').hidden=false;recovery.hidden=true;form.hidden=false;root.querySelector('#u').value=d.username;root.querySelector('#p').value='';root.querySelector('#p').focus();}catch(err){recoveryError.textContent=err.message;recoveryError.hidden=false;}});};
  }
}

export function renderSetup(root, onSuccess) {
  root.innerHTML = shell('Welcome to LIFEGEN Admin', 'Create the first administrator for your website', `
    <form id="setupForm" class="stack" novalidate>
      <div class="alert alert--info">Use the private SETUP_KEY you configured on the server. This one-time setup cannot be claimed without that code. Add Staff and Viewer accounts later in Settings.</div>
      <div id="setupError" class="alert alert--error" hidden></div><div class="field"><label for="setupKey">Private setup code</label><input id="setupKey" name="setup_key" type="password" autocomplete="off" required/><span class="help">SETUP_KEY from the server environment settings — never your Neon database password.</span></div>
      <div class="field"><label for="setup_church_name">Church name</label><input id="setup_church_name" name="church_name" value="Lifegiver Church of Faith" /></div>
      <div class="field"><label for="setup_display_name">Your name <span class="req">*</span></label><input id="setup_display_name" name="display_name" placeholder="e.g. Pastor Juan" required /></div>
      <div class="field"><label for="setup_username">Username <span class="req">*</span></label><input id="setup_username" name="username" autocomplete="username" placeholder="e.g. admin" required /><span class="help">3–32 characters: letters, numbers, dots, dashes or underscores.</span></div>
      <div class="field"><label for="setup_password">Password <span class="req">*</span></label><input id="setup_password" name="password" type="password" autocomplete="new-password" required /><span class="help">At least 12 characters.</span></div>
      <div class="field"><label for="setup_confirm">Confirm password <span class="req">*</span></label><input id="setup_confirm" name="confirm" type="password" autocomplete="new-password" required /></div>
      <button class="btn btn--primary btn--lg btn--block" type="submit">Create admin account</button>
    </form>`);
  const form = root.querySelector('#setupForm');
  const errBox = root.querySelector('#setupError');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(form);
    errBox.hidden = true;
    if (d.password !== d.confirm) { errBox.textContent = 'Passwords do not match.'; errBox.hidden = false; return; }
    await withLoading(form.querySelector('button'), async () => {
      try {
        const { user } = await api.setup({ setup_key:d.setup_key, church_name: d.church_name, display_name: d.display_name, username: d.username, password: d.password });
        onSuccess(user);
      } catch (err) {
        errBox.textContent = err.message;
        errBox.hidden = false;
      }
    });
  };
}
