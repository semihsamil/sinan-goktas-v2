const MOBILE_PHONE_PREFIX = '+90 5';
const MOBILE_PHONE_REGEX = /^\+90 5\d{9}$/;

function normalizeMobilePhone(raw) {
    const digitsOnly = String(raw || '').replace(/\D/g, '');
    let rest = '';
    if (digitsOnly.startsWith('905')) rest = digitsOnly.slice(3);
    else if (digitsOnly.startsWith('5')) rest = digitsOnly.slice(1);
    else rest = digitsOnly;
    rest = rest.slice(0, 9);
    return MOBILE_PHONE_PREFIX + rest;
}

function mobilePhoneForSave(raw) {
    const normalized = normalizeMobilePhone(raw);
    return normalized === MOBILE_PHONE_PREFIX ? '' : normalized;
}

function toMobilePhoneFieldValue(stored) {
    if (!stored || !String(stored).trim()) return MOBILE_PHONE_PREFIX;
    const trimmed = String(stored).trim();
    if (MOBILE_PHONE_REGEX.test(trimmed)) return trimmed;
    return normalizeMobilePhone(trimmed);
}

function stripDigits(value) {
    return String(value || '').replace(/\d/g, '');
}

function sanitizeCoordinate(value) {
    let text = String(value || '').replace(/,/g, '.');
    text = text.replace(/[^\d.]/g, '');
    const parts = text.split('.');
    if (parts.length <= 1) return parts[0] || '';
    return `${parts[0]}.${parts.slice(1).join('')}`;
}

function validateCoordinate(value, fieldLabel, required = false) {
    const trimmed = sanitizeCoordinate(value);
    if (!trimmed) return required ? `${fieldLabel} zorunlu` : null;
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
        return `${fieldLabel} yalnızca sayı olmalı (ör. 39.7477)`;
    }
    return null;
}

function attachCoordinateInput(input) {
    if (!input || input.dataset.coordinateAttached === '1') return;
    input.dataset.coordinateAttached = '1';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    if (!input.placeholder) input.placeholder = '39.7477';

    const apply = () => {
        const cleaned = sanitizeCoordinate(input.value);
        if (cleaned !== input.value) {
            const pos = input.selectionStart ?? cleaned.length;
            input.value = cleaned;
            input.setSelectionRange(Math.min(pos, cleaned.length), Math.min(pos, cleaned.length));
        }
    };

    input.addEventListener('input', apply);
    input.addEventListener('blur', apply);
    input.addEventListener('keypress', (e) => {
        if (!e.key || e.key.length !== 1) return;
        if (/[\d.,]/.test(e.key)) return;
        e.preventDefault();
    });
    input.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData)?.getData('text') || '';
        input.value = sanitizeCoordinate(pasted);
    });
}

function attachCoordinateFields(root = document) {
    root.querySelectorAll('[data-coordinate]').forEach((el) => attachCoordinateInput(el));
}

function validateMobilePhone(phone, required = true) {
    const trimmed = String(phone || '').trim();
    if (!trimmed || trimmed === MOBILE_PHONE_PREFIX) {
        return required ? 'Telefon zorunlu' : null;
    }
    if (!MOBILE_PHONE_REGEX.test(trimmed)) {
        return 'Telefon formatı +90 5XXXXXXXXX olmalı';
    }
    return null;
}

function validateTextName(value, fieldLabel, required = false) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return required ? `${fieldLabel} zorunlu` : null;
    if (trimmed.length < 2 || trimmed.length > 80) {
        return `${fieldLabel} 2-80 karakter olmalı`;
    }
    if (/\d/.test(trimmed)) {
        return `${fieldLabel} alanına rakam yazılamaz`;
    }
    return null;
}

function attachMobilePhoneInput(input, { optional = false } = {}) {
    if (!input || input.dataset.mobilePhoneAttached === '1') return;
    input.dataset.mobilePhoneAttached = '1';
    input.maxLength = 14;
    input.inputMode = 'numeric';
    if (!input.placeholder) input.placeholder = '+90 5XXXXXXXXX';
    input.value = toMobilePhoneFieldValue(input.value);

    const apply = () => {
        const normalized = normalizeMobilePhone(input.value);
        if (input.value !== normalized) input.value = normalized;
        const start = input.selectionStart ?? MOBILE_PHONE_PREFIX.length;
        if (start < MOBILE_PHONE_PREFIX.length) {
            input.setSelectionRange(MOBILE_PHONE_PREFIX.length, MOBILE_PHONE_PREFIX.length);
        }
    };

    input.addEventListener('input', apply);
    input.addEventListener('blur', apply);
    input.addEventListener('keydown', (e) => {
        const start = input.selectionStart ?? 0;
        const end = input.selectionEnd ?? 0;
        if (
            (e.key === 'Backspace' || e.key === 'Delete') &&
            start <= MOBILE_PHONE_PREFIX.length &&
            end <= MOBILE_PHONE_PREFIX.length
        ) {
            e.preventDefault();
        }
    });
    input.addEventListener('focus', () => {
        if ((input.selectionStart ?? 0) < MOBILE_PHONE_PREFIX.length) {
            input.setSelectionRange(MOBILE_PHONE_PREFIX.length, MOBILE_PHONE_PREFIX.length);
        }
    });

    if (optional) input.dataset.mobilePhoneOptional = '1';
}

function attachTextNameInput(input) {
    if (!input || input.dataset.textNameAttached === '1') return;
    input.dataset.textNameAttached = '1';

    input.addEventListener('input', () => {
        const cleaned = stripDigits(input.value);
        if (cleaned === input.value) return;
        const pos = input.selectionStart ?? cleaned.length;
        input.value = cleaned;
        input.setSelectionRange(Math.max(0, pos - 1), Math.max(0, pos - 1));
    });

    input.addEventListener('keypress', (e) => {
        if (e.key && /\d/.test(e.key)) e.preventDefault();
    });
}

function attachMobilePhoneFields(root = document) {
    root.querySelectorAll('[data-mobile-phone]').forEach((el) => {
        attachMobilePhoneInput(el, { optional: el.dataset.mobilePhoneOptional === '1' });
    });
}

function attachTextNameFields(root = document) {
    root.querySelectorAll('[data-text-name]').forEach((el) => attachTextNameInput(el));
}

function formatSalaryDayLabel(day) {
    const n = parseInt(day, 10);
    if (!Number.isInteger(n) || n < 1 || n > 31) return 'Gün seçin';
    return `Her ayın ${n}'i`;
}

function salaryDayPickerValue(day) {
    const n = parseInt(day, 10);
    if (!Number.isInteger(n) || n < 1 || n > 31) return '';
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const maxDay = new Date(year, month + 1, 0).getDate();
    const safeDay = Math.min(n, maxDay);
    const m = String(month + 1).padStart(2, '0');
    const d = String(safeDay).padStart(2, '0');
    return `${year}-${m}-${d}`;
}

function extractDayFromDateValue(value) {
    if (!value) return '';
    const parts = String(value).split('-');
    if (parts.length === 3) {
        const day = parseInt(parts[2], 10);
        return Number.isInteger(day) ? String(day) : '';
    }
    const d = new Date(`${value}T12:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    return String(d.getDate());
}

function attachSalaryDayPicker(picker, hiddenInput, labelEl) {
    if (!picker || picker.dataset.salaryDayBound === '1') return;
    picker.dataset.salaryDayBound = '1';
    picker.addEventListener('change', () => {
        const day = extractDayFromDateValue(picker.value);
        if (hiddenInput) hiddenInput.value = day;
        if (labelEl) labelEl.textContent = formatSalaryDayLabel(day);
    });
}

function attachSalaryDayFields(root = document) {
    root.querySelectorAll('[data-salary-day-picker]').forEach((picker) => {
        const wrap = picker.closest('.salary-day-field');
        const hidden = wrap?.querySelector('[data-salary-day-value]');
        const label = wrap?.querySelector('.salary-day-label');
        if (hidden?.value) picker.value = salaryDayPickerValue(hidden.value);
        if (label) label.textContent = formatSalaryDayLabel(hidden?.value);
        attachSalaryDayPicker(picker, hidden, label);
    });
}

function validateSalaryDayOfMonth(value, required = false) {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return required ? 'Maaş günü zorunlu (takvimden gün seçin)' : null;
    const day = parseInt(trimmed, 10);
    if (!Number.isInteger(day) || day < 1 || day > 31) return 'Maaş günü 1-31 arasında olmalı';
    return null;
}

window.InputFilters = {
    MOBILE_PHONE_PREFIX,
    MOBILE_PHONE_REGEX,
    normalizeMobilePhone,
    mobilePhoneForSave,
    toMobilePhoneFieldValue,
    stripDigits,
    validateMobilePhone,
    validateTextName,
    sanitizeCoordinate,
    validateCoordinate,
    attachMobilePhoneInput,
    attachTextNameInput,
    attachCoordinateInput,
    attachMobilePhoneFields,
    attachTextNameFields,
    attachCoordinateFields,
    formatSalaryDayLabel,
    salaryDayPickerValue,
    attachSalaryDayFields,
    validateSalaryDayOfMonth,
};
