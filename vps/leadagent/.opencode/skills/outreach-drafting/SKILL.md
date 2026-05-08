---
name: outreach-drafting
description: |
  Comment rédiger un message outreach (email cold, LinkedIn DM, SMS) qui convertit
  pour un prospect B2B local français. Style Aaron — direct, court, personnalisé.
metadata:
  workflow: lead-gen
  audience: agence-aaron
---

# Outreach Drafting — playbook

## Principe

Un bon outreach = **1 phrase qui montre que tu as fait tes devoirs + 1 phrase qui propose une valeur précise + 1 CTA simple**. Maximum 6 lignes.

## Structure type (email cold)

```
Subject: [3-5 mots, pas de "Pour {Entreprise}"]

Bonjour [prénom OR rien],

[1 phrase = signal observé spécifique sur eux]

[1 phrase = proposition de valeur ciblée]

[CTA = 1 question simple]

Aaron — Agence
```

## Tone / Voice rules

**À FAIRE** :
- Phrases courtes (< 15 mots)
- "Vous" formel mais chaleureux
- 1 chiffre concret quand possible (avis, follower count, années)
- 1 référence locale si pertinent ("votre quartier", "à Lyon 2", etc.)

**À ÉVITER absolument** :
- "J'espère que vous allez bien"
- "Permettez-moi de me présenter"
- "Notre solution innovante"
- "Boostez votre présence digitale"
- "Leader dans son domaine"
- Tournures CGV-style ("dans le cadre de...", "afin de...")
- Emojis (sauf demande explicite d'Aaron)
- Liens Calendly direct dans le 1er message
- Pièces jointes

## Templates par situation

### Pas de site web

```
Bonjour [prénom],

Je suis tombé sur [restaurant Le Bouchon] — [4,6/5 sur 800 avis], c'est solide. J'ai juste vu que vous n'avez pas de site, vos clients passent par Google Maps + DM Insta.

On fait des sites simples (1 page, booking, plan d'accès) en 2 semaines pour 1500€, livrés clés en main. Ça vous éviterait les 30 DM/jour et ferait remonter votre Google.

10 min cette semaine pour voir si ça vaut le coup ?

Aaron
```

### Site existant mais nul

```
Bonjour [prénom],

J'ai regardé votre site (lebouchonlyon.com) — il marche mais il rame (note 28/100 sur Lighthouse) et il n'est pas mobile. Pour un resto avec 800 avis, c'est dommage.

On le refait en 2 semaines (responsive + booking + 90+ Lighthouse) pour 1800€. Sans toucher à votre marque actuelle.

Vous voulez voir un avant/après sur un client similaire ?

Aaron
```

### Pas de booking pour resto/salon

```
Bonjour [prénom],

Vu votre [salon avec 250 avis] — top travail. Une question : vous prenez les RDV au tel uniquement non ?

On installe un système Calendly intégré au site + SMS auto pour ~600€. La plupart de nos clients récupèrent 5-10h/semaine de tel.

Ça vous parlerait ?

Aaron
```

### LinkedIn DM (3 lignes max)

```
Bonjour [prénom], Aaron d'Agence. Vu [signal très spécifique]. On fait [outcome précis] pour [type] à Lyon, 1500€ en moyenne. Open pour 10 min ?
```

### SMS (200 chars max)

```
Bonjour [prénom], Aaron d'Agence. J'ai vu [signal court]. 1 idée précise pour vous (5 min). Vous êtes joignable cette semaine ?
```

## Personnalisation — d'où sortir le signal ?

Source du signal, par ordre de pertinence :
1. **Avis Google** — note précise + nb d'avis ("4,7/5 sur 312 avis")
2. **Absence de site** — fait observable
3. **Photo Maps** ou détail FB ("votre menu de Pâques sur Insta")
4. **Année de création** ("ouvert en 2018, ça fait 8 ans")
5. **Effectif** ("votre équipe de 5 personnes")
6. **Récompense / presse** ("votre passage dans Le Progrès")

**À ne pas utiliser** comme signal : SIREN, capital social, NAF — données légales, pas humaines.

## Follow-ups (séquence)

Si Aaron demande une séquence email :

- **J0** : email principal (template ci-dessus)
- **J+3** : court rappel — "Vous avez vu mon mail de mardi ?" + 1 ligne nouvelle
- **J+7** : DM LinkedIn — référence à l'email + question simple
- **J+14** : SMS — last touch, ton très direct
- **J+30** : break-up email — "Je laisse tomber, mais si jamais..."

## Output attendu

```yaml
channel: email
subject: "Vos 800 avis et... pas de site"
body: |
  Bonjour Marc,

  Je suis tombé sur Le Bouchon Lyonnais — 4,6/5 sur 800 avis, c'est solide.
  J'ai vu que vous n'avez pas de site, juste Facebook.

  On fait des sites simples (1 page + booking) en 2 semaines pour 1500€.
  Ça vous éviterait les DM et ferait remonter votre Google.

  10 min cette semaine pour voir si ça vaut le coup ?

  Aaron
length_chars: 387
personalization_signals:
  - "Note 4.6/5 et 800 avis (vu sur Google Maps)"
  - "Absence de site web (pas de website_url)"
  - "Présence Facebook seule"
notes: "Si pas de réponse à J+3, follow-up court."
```

## Règles dures

- Jamais de prénom inventé. Si owner_name absent → "Bonjour" tout court.
- Jamais de promesse chiffrée non vérifiable ("+30% de CA").
- Toujours signer "Aaron — Agence" (email) ou "A." (LinkedIn/SMS).
- Maximum 1 lien dans le 1er email (idéalement zéro).
