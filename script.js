const form = document.getElementById('form');
const statusEl = document.getElementById('status');
const results = document.getElementById('results');
const tableBody = document.querySelector('#table tbody');
const countEl = document.getElementById('count');
const csvBtn = document.getElementById('csv');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nicho = document.getElementById('nicho').value.trim();
  const local = document.getElementById('local').value.trim();
  const n = document.getElementById('n').value;

  statusEl.textContent = 'Buscando...';
  results.classList.add('hidden');
  tableBody.innerHTML = '';

  try {
    const url = `${BACKEND}/leads?nicho=${encodeURIComponent(nicho)}&local=${encodeURIComponent(local)}&n=${encodeURIComponent(n)}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    countEl.textContent = data.count ?? (data.items?.length || 0);
    (data.items || []).forEach((i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${i.phone}</td><td>${i.is_whatsapp === null ? '—' : i.is_whatsapp ? 'Sim' : 'Não'}</td>`;
      tableBody.appendChild(tr);
    });
    results.classList.remove('hidden');
    statusEl.textContent = '';
  } catch (err) {
    statusEl.textContent = 'Erro na busca. Tente novamente.';
    console.error(err);
  }
});

csvBtn.addEventListener('click', () => {
  const rows = [['phone','is_whatsapp']];
  document.querySelectorAll('#table tbody tr').forEach(tr => {
    const tds = tr.querySelectorAll('td');
    rows.push([tds[0].textContent, tds[1].textContent]);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'leads.csv';
  a.click();
  URL.revokeObjectURL(a.href);
});
