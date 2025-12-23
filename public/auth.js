// public/auth.js
document.getElementById('showRegister').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('registerForm').style.display = 'block';
  document.getElementById('loginForm').style.display = 'none';
});
document.getElementById('showLogin')?.addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('loginForm').style.display = 'block';
  document.getElementById('registerForm').style.display = 'none';
});

document.getElementById('loginBtn').addEventListener('click', async () => {
  const username = document.getElementById('loginUser').value.toLowerCase();
  const password = document.getElementById('loginPass').value;
  const res = await fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  const status = document.getElementById('authStatus');
  if (data.success) {
    window.location.href = '/panel.html';
  } else {
    status.textContent = 'Usuario o contraseña incorrectos';
  }
});

document.getElementById('regBtn').addEventListener('click', async () => {
  const username = document.getElementById('regUser').value.toLowerCase();
  const password = document.getElementById('regPass').value;
  const res = await fetch('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  const status = document.getElementById('authStatus');
  if (data.success) {
	document.getElementById('loginForm').style.display = 'block';
    status.textContent = 'Registro exitoso. Ahora podés ingresar.';
    document.getElementById('registerForm').style.display = 'none';
  } else {
    status.textContent = 'Error al registrar: ' + (data.message || '');
  }
});