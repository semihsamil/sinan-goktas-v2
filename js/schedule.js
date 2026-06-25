function getTodayMinDate() {
    return new Date().toISOString().slice(0, 10);
}

function applyMinDateInputs(root = document) {
    const min = getTodayMinDate();
    root.querySelectorAll('input[type="date"][data-no-past]').forEach((input) => {
        input.min = min;
        input.addEventListener('change', () => {
            if (input.value && input.value < min) {
                input.value = min;
            }
        });
    });
}

function applyLeaveRangeInputs(root = document) {
    applyMinDateInputs(root);
    const start = root.querySelector('[data-leave-start]');
    const end = root.querySelector('[data-leave-end]');
    if (!start || !end) return;

    const syncEndMin = () => {
        const today = getTodayMinDate();
        const min = start.value && start.value >= today ? start.value : today;
        end.min = min;
        if (end.value && end.value < min) {
            end.value = min;
        }
    };

    if (start.dataset.leaveRangeBound !== '1') {
        start.dataset.leaveRangeBound = '1';
        start.addEventListener('change', syncEndMin);
    }
    if (end.dataset.leaveRangeBound !== '1') {
        end.dataset.leaveRangeBound = '1';
        end.addEventListener('change', () => {
            syncEndMin();
        });
    }
    syncEndMin();
}

function formatLeaveRange(leaveDay, leaveEndDay) {
    if (!leaveDay) return '-';
    const start = formatDateTr(leaveDay);
    if (!leaveEndDay || leaveEndDay === leaveDay) return start;
    return `${start} – ${formatDateTr(leaveEndDay)}`;
}

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text ?? '';
    return d.innerHTML;
}

function formatDateTr(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return escapeHtml(value);
    return d.toLocaleDateString('tr-TR');
}

function formatSalaryDayOfMonth(value) {
    if (!value) return '-';
    const day = parseInt(value, 10);
    if (!Number.isInteger(day) || day < 1 || day > 31) return escapeHtml(String(value));
    return `Her ayın ${day}'i`;
}

async function fetchPersonnelSchedule() {
    const res = await fetch(apiUrl('/api/personnel-schedule'));
    if (!res.ok) throw new Error('Çizelge yüklenemedi');
    return res.json();
}

function renderScheduleGrid(container, rows, { admin = false, onDelete, onEdit } = {}) {
    if (!container) return;
    if (!rows.length) {
        container.innerHTML = '<p class="content-box empty">Henüz çizelge kaydı yok.</p>';
        return;
    }

    container.innerHTML = `<div class="spreadsheet-wrap"><table class="spreadsheet-table">
        <thead>
            <tr>
                <th>Personel</th>
                <th>Maaş Günü</th>
                <th>İzin</th>
                <th>Not</th>
                ${admin ? '<th>İşlem</th>' : ''}
            </tr>
        </thead>
        <tbody>
            ${rows
                .map(
                    (r) => `<tr data-id="${r.id}">
                <td>${escapeHtml(r.fullName || r.username)}</td>
                <td>${formatSalaryDayOfMonth(r.salaryDay)}</td>
                <td>${formatLeaveRange(r.leaveDay, r.leaveEndDay)}</td>
                <td>${escapeHtml(r.note || '-')}</td>
                ${
                    admin
                        ? `<td class="spreadsheet-actions">
                    <button type="button" class="btn btn-ghost btn-sm schedule-edit" data-id="${r.id}">Düzenle</button>
                    <button type="button" class="btn btn-ghost btn-sm schedule-delete" data-id="${r.id}">Sil</button>
                   </td>`
                        : ''
                }
            </tr>`
                )
                .join('')}
        </tbody>
    </table></div>`;

    if (admin) {
        container.querySelectorAll('.schedule-delete').forEach((btn) => {
            btn.addEventListener('click', () => onDelete?.(btn.dataset.id));
        });
        container.querySelectorAll('.schedule-edit').forEach((btn) => {
            btn.addEventListener('click', () => onEdit?.(btn.dataset.id, rows));
        });
    }
}

window.ScheduleUi = {
    getTodayMinDate,
    applyMinDateInputs,
    applyLeaveRangeInputs,
    fetchPersonnelSchedule,
    renderScheduleGrid,
    formatDateTr,
    formatSalaryDayOfMonth,
    formatLeaveRange,
};
