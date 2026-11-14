# Frontend FairJack VRF

React, Vite e TypeScript. Usa i contratti e il deploy descritti nel README della
root. `npm run deploy:local` o `npm run deploy:sepolia` genera `.env.local`.
I vecchi indirizzi del protocollo con validator sono **STORICI / OBSOLETI**:
sono conservati soltanto [nell'archivio Sepolia](../docs/deployments/sepolia-legacy.md).
Usa i valori del nuovo deploy VRF e verifica rete e versione nell'intestazione
del file generato. `.env.example` è un modello, non un deploy già disponibile.
Un deploy locale sovrascrive `.env.local`: conserva prima una copia della
configurazione Sepolia e riavvia Vite quando cambi rete o indirizzi.

```bash
npm ci
npm run dev
```

La UI include token, share FJT, riserva ETH, sessioni di gioco e tavolo asincrono.
Avvia anche `npm run relayer:dev` dalla root: Vite inoltra `/api` al backend.
La sessione dura al massimo 30 minuti e autorizza soltanto Start, Hit e Stand;
la chiave temporanea resta in memoria. Approve iniziale e revoca passano dal
wallet principale. Un refresh richiede una nuova sessione, mantenendo la
possibilità di riprendere le mani già iniziate tramite il loro ID.

Il **dealer** elabora automaticamente VRF e, solo localmente, può simulare il
mock. La modalità wallet esplicita mantiene i pulsanti manuali e il gas a carico
dell'utente. Usa “Verifica operazione” dopo una risposta di rete incerta.
Il deploy deve esporre le API delle sessioni: la precedente versione VRF richiede
un nuovo deploy. Per l'hosting, il backend può servire `frontend/dist` sulla
stessa origine delle API; configurazione completa nel README della root.

Dalla root, `npm run abi:sync` aggiorna le ABI dai contratti compilati.
Per verificare il frontend: `npm run build` e `npm run lint`.
