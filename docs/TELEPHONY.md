# Téléphonie Twilio (navigateur + mobile + transcription)

## Prérequis

1. Compte [Twilio](https://www.twilio.com) + un **numéro Voice** (acheté chez Twilio).
2. Migrations Supabase : `006_telephony.sql` puis `007_telephony_transcription.sql`.

## Console Twilio

1. **API Key** (Console → Account → API keys & tokens)  
   - Créer une clé API → noter `SID` et `SECRET`.

2. **TwiML App** (Voice → TwiML → TwiML Apps)  
   - Créer une app → **Voice request URL** :  
     `https://VOTRE_DOMAINE/api/telephony/voice`  
     Méthode : **HTTP POST**  
   - Copier le **Application SID** (`AP…`).

3. **Numéro Twilio** : noter l’E.164 (`+33…`) — c’est le **seul** numéro utilisable comme `from` pour les appels API.

## Variables d’environnement (Vercel + local)

```env
# Obligatoires Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_PHONE_NUMBER=+33xxxxxxxxx
TWILIO_TWIML_APP_SID=APxxxxxxxx
TWILIO_API_KEY_SID=SKxxxxxxxx
TWILIO_API_KEY_SECRET=xxxxxxxx

# Caller ID affiché au client (optionnel mais recommandé)
# Si tu utilises un 06/07 perso vérifié comme identité affichée :
# TWILIO_CALLER_ID=+33xxxxxxxxx
# Sinon, Twilio utilisera TWILIO_PHONE_NUMBER comme caller ID.

# Transfert « responsable » (E.164)
TWILIO_TRANSFER_TO_BOSS=+33xxxxxxxxx

# Transcription après enregistrement (Gemini — même clé que le reste du projet)
GEMINI_API_KEY=xxxxxxxx

# URL publique exacte des webhooks (si besoin, ex. reverse proxy)
# NEXT_PUBLIC_APP_URL=https://votredomaine.com
# TWILIO_WEBHOOK_BASE_URL=https://votredomaine.com

# Dev uniquement : ignorer la signature Twilio (ne jamais en prod)
# SKIP_TWILIO_SIGNATURE_VALIDATION=true
```

Les webhooks suivants doivent être **accessibles en HTTPS** :

- `POST /api/telephony/voice` (TwiML App Voice URL)
- `POST /api/telephony/webhooks/status`
- `POST /api/telephony/webhooks/recording`

En production, les URLs absolues viennent de `NEXT_PUBLIC_APP_URL` ou `VERCEL_URL`.

## Fonctionnement

| Mode | Description |
|------|-------------|
| **Navigateur** | Voice SDK (WebRTC) → TwiML `/api/telephony/voice` → compose le client, enregistrement, puis transcription Gemini. |
| **Mon mobile** | Twilio appelle d’abord le numéro enregistré (« Ton numéro »), puis le client (`/api/telephony/twiml/click-connect`). L’API renvoie un `callSid` pour transfert / raccroché depuis l’UI. |
| **Transfert** | API `POST /api/telephony/transfer` avec le `callSid` actif (navigateur ou mobile). |
| **Raccrocher (mobile)** | `POST /api/telephony/hangup` avec le même `callSid`. |

**Important :** `TWILIO_PHONE_NUMBER` doit être un **numéro Twilio**. Tu ne peux pas mettre ton 06 personnel comme `from` sur les appels API ; utilise `TWILIO_CALLER_ID` pour afficher un numéro vérifié au destinataire.

### Dépannage : « Busy », 0 s, le mobile ne sonne pas

Si dans les logs Twilio **From** et **To** sont **le même numéro**, Twilio tente d’appeler un numéro depuis lui-même → statut **Busy**. Il faut deux numéros distincts :

- **`TWILIO_PHONE_NUMBER`** = numéro **acheté chez Twilio** (identité technique de l’appel sortant).
- **Ton portable** = uniquement dans l’app (section « Ton numéro ») pour recevoir le click-to-call — **pas** la même valeur que `TWILIO_PHONE_NUMBER`.

## Légal (France / UE)

Informer les parties et respecter le RGPD pour les enregistrements et transcriptions ; documenter en interne.
