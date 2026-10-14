import { api } from '../api.js';
import { duplicateGuard } from './personForm.js';
import { icon, withLoading, toast } from '../ui.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

/** A small, separate registration form. A Person is registered before saving the Network. */
export function networkLeaderRegistrationHtml() {
  return `<section id="netRegisterPanel" class="network-leader-register" hidden aria-label="Register a new Network Leader">
    <div class="network-leader-register__header"><strong>Register a new leader</strong>
      <button type="button" id="netRegisterClose" class="btn btn--sm" aria-label="Close registration">${icon('close', 15).value}</button>
    </div>
    <p class="help">Register the person first, then save the Network to link them. Use a registered person instead if they already have a profile.</p>
    <form id="netRegisterForm" novalidate>
      <div id="netRegisterError" class="alert alert--error" role="alert" hidden></div>
      <div id="netRegisterDuplicates" class="alert alert--warn" hidden></div>
      <div class="form-grid">
        <div class="field"><label for="netRegFirst">First name <span class="req">*</span></label>
          <input name="first_name" id="netRegFirst" maxlength="120" autocomplete="given-name" required /></div>
        <div class="field"><label for="netRegLast">Last name <span class="req">*</span></label>
          <input name="last_name" id="netRegLast" maxlength="120" autocomplete="family-name" required /></div>
        <div class="field span-2"><label for="netRegPhone">Contact number <span class="opt">optional</span></label>
          <input name="contact_number" id="netRegPhone" type="tel" maxlength="32" autocomplete="tel" /></div>
      </div>
      <div class="network-leader-register__category" id="netRegCategory" aria-live="polite"></div>
      <label class="network-leader-register__consent"><input type="checkbox" id="netRegConsent" required />
        <span>I confirm the person has agreed to LIFEGEN storing their registration details for church follow-up.</span></label>
      <div class="row network-leader-register__footer">
        <button type="button" class="btn" id="netRegCancel">Cancel</button>
        <button type="submit" class="btn btn--primary" id="netRegSubmit">Register & select</button>
      </div>
    </form>
  </section>`;
}

/**
 * Safe two-stage flow: explicitly create the Person record, then return its ID
 * to the Network form. Editing a Network never silently creates or updates people.
 */
export function bindNetworkLeaderRegistration(modal, { genderNow, onRegistered, onError }) {
  const panel = modal.querySelector('#netRegisterPanel');
  const toggle = modal.querySelector('#netLeaderRegister');
  if (!panel || !toggle) return;
  const form = panel.querySelector('#netRegisterForm');
  const errorBox = panel.querySelector('#netRegisterError');
  const duplicates = panel.querySelector('#netRegisterDuplicates');
  const sexOf = { boys: 'male', girls: 'female' };
  let creating = false;

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }
  function updateCategory() {
    const category = genderNow();
    const indicator = panel.querySelector('#netRegCategory');
    indicator.innerHTML = category === 'boys' ?
      '<span class="network-leader-register__sex" role="img" aria-label="Boys network">'+icon('mars', 19).value+'</span>' :
      category === 'girls' ?
      '<span class="network-leader-register__sex" role="img" aria-label="Girls network">'+icon('venus', 19).value+'</span>' :
      '<span class="network-leader-register__sex">Choose a Network category first</span>';
  }
  function close() {
    if (creating) return;
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  }
  function open() {
    if (!sexOf[genderNow()]) {
      onError?.('Choose the Network category icon before registering its leader.');
      return;
    }
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    errorBox.hidden = true;
    duplicates.hidden = true;
    updateCategory();
    panel.querySelector('#netRegFirst').focus();
  }
  toggle.onclick = () => panel.hidden ? open() : close();
  panel.querySelector('#netRegisterClose').onclick = close;
  panel.querySelector('#netRegCancel').onclick = close;
  modal.querySelectorAll('input[name="gender"]').forEach(input => input.addEventListener('change', updateCategory));
  updateCategory();

  form.onsubmit = async event => {
    event.preventDefault();
    if (creating) return;
    errorBox.hidden = true;
    const category = genderNow();
    const first = form.querySelector('#netRegFirst').value.trim();
    const last = form.querySelector('#netRegLast').value.trim();
    const contact = form.querySelector('#netRegPhone').value.trim();
    const consent = form.querySelector('#netRegConsent').checked;
    if (!sexOf[category]) return showError('Choose the Network category first.');
    if (!first || !last) return showError('Enter the leader’s first and last name.');
    if (!consent) return showError('Confirm data privacy consent before registering the person.');
    const data = {
      first_name: first, last_name: last, contact_number: contact || null,
      status: 'leader', sex: sexOf[category], privacy_consent: true,
    };
    creating = true;
    const categories = [...modal.querySelectorAll('input[name="gender"]')];
    categories.forEach(input => { input.disabled = true; });
    try {
      await withLoading(form.querySelector('#netRegSubmit'), async () => {
        if (!(await duplicateGuard(data, duplicates))) return;
        const person = await api.createPerson(data);
        if (!person?.id) throw new Error('Registration returned no Person ID.');
        onRegistered({ id: person.id, name: [person.first_name || first, person.last_name || last].join(' ').trim() });
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        form.reset();
        duplicates.hidden = true;
        toast('Leader registered. Save the Network to complete the link.', 'success');
      });
    } catch (error) {
      showError(error.message || 'Could not register the leader.');
    } finally {
      creating = false;
      categories.forEach(input => { input.disabled = false; });
    }
  };
}
