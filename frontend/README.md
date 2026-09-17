# FairJack frontend

Console React/Vite per collaudare il protocollo FairJack. Espone tutte le operazioni utente del token e di `FairJackPool`, conserva i segreti commit/reveal nel `localStorage` separandoli per chain, contratto, partita e account, e include un controllo locale per superare le deadline senza attendere 5/15 minuti.

La configurazione viene generata automaticamente da `npm run deploy:local` nella root. Per una configurazione manuale, copia `.env.example` in `.env.local` e inserisci gli indirizzi del deploy.

```bash
npm install
npm run dev
```

Per typecheck e build:

```bash
npm run build
npm run lint
```
