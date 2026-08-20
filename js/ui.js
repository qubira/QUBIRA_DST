import { icon } from './utils.js';

const overlay = document.getElementById('modal-overlay');
const toastContainer = document.getElementById('toast-container');

let activeResolve = null;

export function openModal({ title, bodyHtml, footerHtml = '', size = '' }) {
  overlay.innerHTML = `
    <div class="modal ${size ? 'modal--' + size : ''}">
      <div class="modal__header">
        <h2>${title}</h2>
        <button class="close-btn" data-close>${icon('close')}</button>
      </div>
      <div class="modal__body">${bodyHtml}</div>
      ${footerHtml ? `<div class="modal__footer">${footerHtml}</div>` : ''}
    </div>
  `;
  overlay.classList.add('active');
  overlay.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', closeModal));
  return overlay.querySelector('.modal');
}

export function closeModal() {
  overlay.classList.remove('active');
  overlay.innerHTML = '';
  if (activeResolve) { activeResolve(false); activeResolve = null; }
}

overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && overlay.classList.contains('active')) closeModal();
});

export function confirmDialog(message, { title = 'Confirmar acción', confirmLabel = 'Confirmar', danger = true } = {}) {
  return new Promise((resolve) => {
    activeResolve = resolve;
    openModal({
      title,
      size: 'sm',
      bodyHtml: `<p style="margin:0;color:var(--text-muted);font-size:13.5px;">${message}</p>`,
      footerHtml: `
        <button class="btn btn-secondary" data-close>Cancelar</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-ok">${confirmLabel}</button>
      `,
    });
    document.getElementById('confirm-ok').addEventListener('click', () => {
      activeResolve = null;
      resolve(true);
      closeModal();
    });
  });
}

export function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const iconName = type === 'success' ? 'check-circle' : type === 'error' ? 'alert-triangle' : 'bell';
  el.innerHTML = `${icon(iconName)}<span>${message}</span>`;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s, transform .2s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 200);
  }, 3200);
}
