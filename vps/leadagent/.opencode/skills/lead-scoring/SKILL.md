---
name: lead-scoring
description: |
  Comment calculer un score 0-100 pour un lead B2B local français selon son
  potentiel commercial pour une agence digitale. Utilise après enrichissement,
  avant de classer en hot/warm/cold.
metadata:
  workflow: lead-gen
  audience: agence-aaron
---

# Lead Scoring — barème

## Philosophie

Un bon prospect pour Agence (création de site + acquisition) doit cumuler :
1. **Un manque évident** (pas de site, site nul, pas de SEA)
2. **Une capacité à payer** (entreprise existante, revenus, employés)
3. **Une crédibilité commerciale** (avis OK, présence locale)

Le score = somme de signaux pondérés sur 100.

## Barème

### A. Manque digital — max 40 points

| Critère | Points |
|---|---|
| Pas de site web du tout | +25 |
| Site mais quality `none` (juste FB) | +20 |
| Site mais quality `dead` (404, timeout) | +20 |
| Site mais quality `outdated` (design 2010, pas responsive) | +15 |
| Site mais quality `poor` (Lighthouse < 50) | +10 |
| Pas de HTTPS | +5 |
| Pas de système de booking en ligne (pour resto/salon) | +5 |
| Pas de Meta Ads actives | +5 |

### B. Capacité à payer — max 30 points

| Critère | Points |
|---|---|
| Effectif 5-50 employés (sweet spot PME) | +12 |
| Effectif 1-5 (TPE viable) | +8 |
| Effectif 50+ | +6 (souvent déjà digital ou trop gros) |
| Effectif 0/non trouvé | +2 |
| Capital social >= 10k€ | +5 |
| Revenue bracket connu et > 200k€ | +8 |
| Entreprise > 2 ans (stable) | +5 |
| Entreprise < 1 an | -3 (trop jeune, peu d'argent) |
| Forme juridique : SAS, SARL, SASU | +3 |
| Auto-entrepreneur | -5 |

### C. Crédibilité / présence locale — max 20 points

| Critère | Points |
|---|---|
| Note Google >= 4.5 et >= 50 avis | +12 |
| Note Google 4.0-4.5 ou 20-50 avis | +8 |
| Note Google >= 4.0 et < 20 avis | +4 |
| Note Google < 4.0 | 0 |
| Page Facebook active (followers >= 500) | +5 |
| Instagram actif | +3 |
| Mentionné dans presse locale | +3 |

### D. Qualité de la donnée — max 10 points (bonus de qualif)

| Critère | Points |
|---|---|
| Email direct du dirigeant trouvé | +5 |
| Téléphone direct du dirigeant trouvé | +3 |
| LinkedIn dirigeant trouvé | +2 |

## Tiering

- **Hot (80-100)** : forte douleur digitale + capacité à payer + facile à contacter → on attaque ce mois
- **Warm (60-79)** : bon potentiel mais 1 manque clé (ex pas de contact direct dirigeant) → relance après recherche complémentaire
- **Cold (<60)** : intéressant mais pas prioritaire → batch outreach standard

## Output attendu

Pas seulement un score : produis aussi un mini-diagnostic en 2-3 lignes.

```yaml
potential_score: 78
priority_score: "warm"
prospect_analysis: |
  Restaurant solide (4,6/5 sur 320 avis) sans site — uniquement Facebook avec 1200 fans.
  PME 8 employés créée en 2017, capital 30k€. Forte douleur digitale.
identified_need: "Site web vitrine + booking en ligne"
targeted_offer: "Pack site WordPress 1500€ + Calendly intégré"
```

## Cas particuliers

- **Restaurant ou bar** : le booking en ligne est critique. Si absent → +10 au lieu de +5
- **Salon de coiffure / esthétique** : booking idem, +10
- **Boulangerie / commerce de proximité** : moins critique pour le booking, mais carte interactive +5
- **B2B (avocats, comptables)** : LinkedIn du dirigeant +5 supplémentaires si présent
