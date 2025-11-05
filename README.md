# Desafio de Damas - Demo (sandbox, v2)

Projeto demo que coloca um jogo de damas online com integração *modelo* com PixUp sandbox, Supabase e Socket.IO.
**Uso educacional / sandbox** — antes de usar em produção adapte segurança, KYC e política legal.

## Regras financeiras configuradas
- Minimum stake por partida: R$ 10.00
- Platform fee per match: R$ 1.00 (deduzido do prêmio antes de payout)
- Withdraw platform fee: 3% (cobrado quando usuário solicita saque; actual payout via PixUp não implementado)

## Estrutura
- `server.js` - backend (Express + Socket.IO + SQLite)
- `public/` - frontend (index.html, style.css, app.js)
- `.env.example` - variáveis de ambiente (preencha)
- `db.sqlite` será criado automaticamente no servidor

## Como usar localmente (teste)
1. `npm install`
2. Crie arquivo `.env` baseado em `.env.example`
3. `node server.js`
4. Abra `http://localhost:3000`

Se quiser testar webhooks da PixUp localmente, use `ngrok http 3000` e coloque o ngrok URL como `PUBLIC_URL` e no painel PixUp webhook.

## Deploy rápido (Vercel)
1. Crie repositório Git com os arquivos.
2. Import no Vercel (https://vercel.com/new).
3. Configure as Environment Variables no painel do Vercel (mesmos nomes do `.env.example`).
4. Deploy.

## Atenção
- O webhook em `server.js` é um exemplo. **Adapte o parsing do payload** para o formato exato que PixUp envia.
- Não comite segredos no repositório público.
- Operações com dinheiro real exigem conformidade legal — use sandbox para testes.
