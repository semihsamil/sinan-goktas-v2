document.addEventListener('DOMContentLoaded', async () => {
    const grid = document.getElementById('schedule-grid');
    if (!grid) return;

    async function load() {
        try {
            const rows = await ScheduleUi.fetchPersonnelSchedule();
            ScheduleUi.renderScheduleGrid(grid, rows, { admin: false });
        } catch (e) {
            grid.innerHTML = `<p class="form-status error">${e.message}</p>`;
        }
    }

    await load();
    setInterval(load, 20000);
});
