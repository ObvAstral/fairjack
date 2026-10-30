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

La UI include token, share FJT, riserva ETH dell'oracolo e tavolo asincrono.
Le risposte vengono rilevate con polling; l'elaborazione è permissionless e
richiede una transazione esplicita. Il pulsante di simulazione del mock e gli
strumenti per avanzare il tempo sono presenti solo su chain ID 31337.

Dalla root, `npm run abi:sync` aggiorna le ABI dai contratti compilati.
Per verificare il frontend: `npm run build` e `npm run lint`.
