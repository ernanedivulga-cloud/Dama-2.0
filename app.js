// public/app.js - simple frontend for demo (Desafio de Damas)
const socket = io();

let token = null;
let me = null;
let currentRoom = null;

async function api(path, opts = {}) {
  const headers = opts.headers || {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json', ...headers }, ...opts });
  return res.json();
}

const authDiv = document.getElementById('auth');
const lobbyDiv = document.getElementById('lobby');
const gameDiv = document.getElementById('game');
const usernameInput = document.getElementById('username');
const btnRegister = document.getElementById('btn-register');
const authMsg = document.getElementById('auth-msg');
const myName = document.getElementById('my-name');
const myBalance = document.getElementById('my-balance');
const depositAmount = document.getElementById('deposit-amount');
const btnDeposit = document.getElementById('btn-deposit');
const stakeAmount = document.getElementById('stake-amount');
const btnCreateRoom = document.getElementById('btn-create-room');
const roomsList = document.getElementById('rooms-list');
const btnWithdraw = document.getElementById('btn-withdraw');
const btnLogout = document.getElementById('btn-logout');

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const roomIdSpan = document.getElementById('room-id');
const btnResign = document.getElementById('btn-resign');
const gameLog = document.getElementById('game-log');

btnRegister.onclick = async () => {
  const username = usernameInput.value.trim();
  if (!username) return authMsg.innerText = 'Digite um username';
  let r = await fetch('/api/login', {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username })
  });
  let data = await r.json();
  if (r.status !== 200) {
    r = await fetch('/api/register', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username })
    });
    data = await r.json();
  }
  if (data.error) return authMsg.innerText = data.error;
  token = data.token;
  me = data.user;
  showLobby();
  refreshUser();
  fetchRooms();
};

btnLogout.onclick = () => {
  token = null; me = null;
  authDiv.style.display = 'block';
  lobbyDiv.style.display = 'none';
  gameDiv.style.display = 'none';
};

async function refreshUser(){
  if (!token) return;
  const j = await api('/me');
  if (j.user) {
    me = j.user;
    myName.innerText = me.username;
    myBalance.innerText = Number(me.balance).toFixed(2);
  }
}

btnDeposit.onclick = async () => {
  const amount = parseFloat(depositAmount.value);
  if (!amount || amount <= 0) return alert('valor inválido');
  const r = await api('/pix/create_charge', { method: 'POST', body: JSON.stringify({ amount }) });
  if (r.error) return alert('Erro ao criar cobrança: ' + (r.error || JSON.stringify(r)));
  alert('Cobrança criada (sandbox). Confira no console para detalhes.');
  console.log('charge', r.charge || r);
};

btnCreateRoom.onclick = async () => {
  const stake = parseFloat(stakeAmount.value);
  if (!stake || stake <= 0) return alert('informe stake');
  const r = await api('/rooms', { method: 'POST', body: JSON.stringify({ stake }) });
  if (r.error) return alert('Erro: ' + r.error);
  currentRoom = r.room;
  enterGame(currentRoom);
  fetchRooms();
};

function fetchRooms() {
  roomsList.innerHTML = '<li>Crie uma sala e compartilhe o link com seu adversário. (Ex: https://seu-dominio/?join=ROOM_ID)</li>';
}

function tryAutoJoinFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const join = params.get('join');
  if (join && token) {
    joinRoom(join);
  }
}
async function joinRoom(roomId) {
  const r = await api(`/rooms/${roomId}/join`, { method: 'POST' });
  if (r.error) return alert('Erro ao entrar: ' + r.error);
  currentRoom = r.room;
  enterGame(currentRoom);
  fetchRooms();
}

function showLobby(){
  authDiv.style.display = 'none';
  lobbyDiv.style.display = 'block';
  gameDiv.style.display = 'none';
}

function enterGame(room) {
  authDiv.style.display = 'none';
  lobbyDiv.style.display = 'none';
  gameDiv.style.display = 'block';
  roomIdSpan.innerText = room.id;
  socket.emit('join_room', room.id);
  initBoard();
}

// Simple board (demo)
const BOARD_SIZE = 8;
const TILE = canvas.width / BOARD_SIZE;
let boardState = null;

function initBoard() {
  boardState = Array.from({length:8}, () => Array(8).fill(0));
  for (let r=0;r<3;r++){
    for (let c=0;c<8;c++){
      if ((r+c)%2===1) boardState[r][c] = 1;
    }
  }
  for (let r=5;r<8;r++){
    for (let c=0;c<8;c++){
      if ((r+c)%2===1) boardState[r][c] = 2;
    }
  }
  drawBoard();
}

function drawBoard(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for (let r=0;r<8;r++){
    for (let c=0;c<8;c++){
      const x = c * TILE, y = r * TILE;
      const dark = (r+c)%2 === 1;
      ctx.fillStyle = dark ? '#6b3' : '#fff';
      ctx.fillRect(x,y,TILE,TILE);
      const val = boardState[r][c];
      if (val) {
        ctx.beginPath();
        ctx.arc(x + TILE/2, y + TILE/2, TILE*0.36, 0, Math.PI*2);
        ctx.fillStyle = val===1 ? '#222' : '#ffd700';
        ctx.fill();
      }
    }
  }
}

let selected = null;
canvas.addEventListener('click', (ev) => {
  if (!currentRoom) return alert('sem sala ativa');
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  const c = Math.floor(x / TILE);
  const r = Math.floor(y / TILE);
  if (selected) {
    boardState[r][c] = boardState[selected.r][selected.c];
    boardState[selected.r][selected.c] = 0;
    selected = null;
    drawBoard();
    socket.emit('move', { roomId: currentRoom.id, move: { from: selected, to: {r,c} } });
  } else {
    if (boardState[r][c] !== 0) {
      selected = { r, c };
    }
  }
});

socket.on('move', (move) => {
  if (!move) return;
  boardState[move.to.r][move.to.c] = boardState[move.from.r][move.from.c];
  boardState[move.from.r][move.from.c] = 0;
  drawBoard();
});

socket.on('room_started', (room) => {
  gameLog.innerText += '\nSala começou!';
});
socket.on('room_finished', (room) => {
  gameLog.innerText += '\nSala finalizou! vencedor: ' + room.winner_id;
  refreshUser();
});

btnResign.onclick = async () => {
  if (!currentRoom) return;
  const isSure = confirm('Deseja desistir e dar a vitória ao oponente?');
  if (!isSure) return;
  const winner = (currentRoom.host_id === me.id) ? currentRoom.guest_id : currentRoom.host_id;
  const r = await api(`/rooms/${currentRoom.id}/result`, { method: 'POST', body: JSON.stringify({ winnerId: winner }) });
  if (r.error) return alert('Erro ao finalizar: ' + r.error);
  alert('Partida finalizada. O vencedor foi: ' + winner);
  refreshUser();
  showLobby();
};

btnWithdraw.onclick = async () => {
  const valor = parseFloat(prompt('Valor para saque (R$):'));
  if (!valor) return;
  const r = await api('/withdraw', { method: 'POST', body: JSON.stringify({ amount: valor }) });
  if (r.error) return alert('Erro: ' + r.error);
  alert(`Pedido de saque enviado. Valor: R$${r.amount} | Taxa: R$${r.fee} | Debitado: R$${r.debited}`);
  refreshUser();
};

tryAutoJoinFromUrl();
