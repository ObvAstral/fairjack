# FairJack frontend

Console React/Vite per collaudare il protocollo FairJack su Hardhat Local o Sepolia. Espone tutte le operazioni utente del token e di `FairJackPool`, conserva i segreti commit/reveal nel `localStorage` separandoli per chain, contratto, partita e account e, solo sulla chain locale, permette di superare le deadline senza attendere 5/15 minuti.

La configurazione viene generata automaticamente da `npm run deploy:local` o `npm run deploy:sepolia` nella root. Per una configurazione manuale, copia `.env.example` in `.env.local` e inserisci indirizzi del deploy e un RPC Sepolia browser-safe.

```bash
npm install
npm run dev
```

Per typecheck e build:

```bash
npm run build
npm run lint
```
