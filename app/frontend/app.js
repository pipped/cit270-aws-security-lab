// API_BASE is set by the nginx config or the EC2 user-data script at deploy time.
// When running locally, point it at localhost:3000.
const API_BASE = window.API_BASE || 'http://localhost:3000';

const badge = document.getElementById('tier-badge');
const taskForm = document.getElementById('task-form');
const taskInput = document.getElementById('task-input');
const taskList = document.getElementById('task-list');
const taskCount = document.getElementById('task-count');

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function checkHealth() {
  try {
    const data = await api('GET', '/health');
    badge.textContent = `App tier: ${data.status}`;
    badge.className = 'badge ok';
  } catch {
    badge.textContent = 'App tier: unreachable';
    badge.className = 'badge err';
  }
}

function renderTasks(tasks) {
  taskCount.textContent = tasks.length;
  if (tasks.length === 0) {
    taskList.innerHTML = '<p class="empty-state">No tasks yet. Add one above.</p>';
    return;
  }
  taskList.innerHTML = tasks.map(t => `
    <div class="task-item" data-id="${t.id}">
      <input type="checkbox" ${t.completed ? 'checked' : ''} />
      <span class="task-title ${t.completed ? 'done' : ''}">${escapeHtml(t.title)}</span>
      <button class="delete-btn">Delete</button>
    </div>
  `).join('');

  taskList.querySelectorAll('.task-item').forEach(item => {
    const id = item.dataset.id;
    const checkbox = item.querySelector('input[type="checkbox"]');
    const title = item.querySelector('.task-title');
    const deleteBtn = item.querySelector('.delete-btn');

    checkbox.addEventListener('change', async () => {
      try {
        await api('PATCH', `/api/tasks/${id}`, { completed: checkbox.checked });
        title.classList.toggle('done', checkbox.checked);
      } catch (e) {
        checkbox.checked = !checkbox.checked;
        alert(e.message);
      }
    });

    deleteBtn.addEventListener('click', async () => {
      try {
        await api('DELETE', `/api/tasks/${id}`);
        item.remove();
        taskCount.textContent = parseInt(taskCount.textContent) - 1;
      } catch (e) {
        alert(e.message);
      }
    });
  });
}

async function loadTasks() {
  try {
    const tasks = await api('GET', '/api/tasks');
    renderTasks(tasks);
  } catch {
    taskList.innerHTML = '<p class="empty-state">Could not reach the app tier. Check your security group rules.</p>';
  }
}

taskForm.addEventListener('submit', async e => {
  e.preventDefault();
  const title = taskInput.value.trim();
  if (!title) return;
  const btn = taskForm.querySelector('button');
  btn.disabled = true;
  try {
    await api('POST', '/api/tasks', { title });
    taskInput.value = '';
    await loadTasks();
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
  }
});

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

checkHealth();
loadTasks();
