# Téléphonie Twilio (appels navigateur + mobile)

## Prérequis

1. Compte [Twilio](https://www.twilio.com) + un **numéro** d’appel (Voice capable).
2. Migration Supabase : `006_telephony.sql` appliquée sur votre projet.

## Console Twilio

1. **API Key** (Console → Account → API keys & tokens)  
   - Créer une clé API → noter `SID` et `SECRET`.

2. **TwiML App** (Voice → TwiML → TwiML Apps)  
   - Créer une app → **Voice request URL** :  
     `https://VOTRE_DOMAINE/api/telephony/voice`  
     Méthode : **HTTP POST**  
   - Copier le **Application SID** (`AP…`).

3. **Numéro Twilio** : acheter / utiliser un numéro ; noter l’E.164 (`+33…`).

## Variables d’environnement (Vercel + local)

```env
# Obligatoires
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_PHONE_NUMBER=+33xxxxxxxxx
TWILIO_TWIML_APP_SID=APxxxxxxxx
TWILIO_API_KEY_SID=SKxxxxxxxx
TWILIO_API_KEY_SECRET=xxxxxxxx

# Transfert « responsable » (E.164)
TWILIO_TRANSFER_TO_BOSS=+33xxxxxxxxx

# URL publique exacte des webhooks (si besoin, ex. reverse proxy)
# NEXT_PUBLIC_APP_URL=https://votredomaine.com
# TWILIO_WEBHOOK_BASE_URL=https://votredomaine.com

# Dev uniquement : ignorer la signature Twilio (ne jamais en prod)
# SKIP_TWILIO_SIGNATURE_VALIDATION=true
```

Les webhooks suivants doivent être **accessibles en HTTPS** :

- `POST /api/telephony/voice` (déjà référencé dans la TwiML App)
- `POST /api/telephony/webhooks/status`
- `POST /api/telephony/webhooks/recording`

Configurez-les dans la TwiML App **Dial** (déjà renvoyés par le code) — en production Twilio utilisera les URLs absolues basées sur `NEXT_PUBLIC_APP_URL` ou `VERCEL_URL`.

## Fonctionnement

| Mode | Description |
|------|-------------|
| **Navigateur** | Voice SDK (WebRTC) → TwiML `/api/telephony/voice` → compose le client, enregistrement. |
| **Mon mobile** | Twilio appelle d’abord le numéro enregistré dans « Votre numéro », puis le client (`/api/telephony/twiml/click-connect`). |
| **Transfert** | Pendant un appel navigateur : API `/api/telephony/transfer` redirige l’appel vers `TWILIO_TRANSFER_TO_BOSS`. |

## Légal (France / UE)

Informer les parties et respecter le RGPD pour les enregistrements vocaux ; documenter en interne.
