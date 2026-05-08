---
name: lead-enrichment
description: |
  Comment enrichir un lead avec données légales (SIREN, dirigeant), coordonnées
  (téléphone, email), web (site, qualité) et social (FB, LinkedIn).
  Utilise pour transformer un lead "brut" en dossier complet sauvegardable.
metadata:
  workflow: lead-gen
  audience: agence-aaron
---

# Lead Enrichment — playbook

## Inputs attendus

```yaml
business_name: "..."
location: "Ville [, CP]"
# Optionnels mais utiles :
phone: "..."
website_url: "..."
google_maps_url: "..."
siren: "..."
```

## Phase 1 — Légal (parallèle, APIs only, ~3-5s)

Lance en parallèle :

1. `pappers_search({ business_name, location, [siren] })` — owner_name, owner_role, SIREN, capital, NAF, effectif, date de création, adresse RCS
2. `societe_com_search({ business_name, location })` — backup, surtout pour confirmer dirigeant

**Merge logic** :
- Pappers est prioritaire pour SIREN, employee_count, creation_date
- Société.com est prioritaire pour le revenue_bracket
- Pour le dirigeant : si Pappers a "PP" (personne physique) → c'est le bon. Sinon Société.

Si AUCUN ne retourne rien (entreprise très récente, association, micro-entreprise) → continue sans données légales mais log un warning.

## Phase 2 — Coordonnées (parallèle, ~5-10s)

1. `pages_jaunes_search({ query: business_name, location, phone })` — phone, email, address
2. Si `website_url` connu → `webfetch({ url: website_url + "/contact" })` → parse email/phone du HTML

## Phase 3 — Web (séquentiel, ~10-20s)

1. **Trouver le site** si pas connu :
   - Lancer `websearch({ query: '"{business_name}" {location} site officiel' })`
   - Filtrer les résultats : exclure facebook.com, instagram.com, tripadvisor.com, thefork.com, linkedin.com
   - Garder le 1er résultat qui ressemble à un domaine business (pas un agrégateur)
2. **Audit** :
   - `website_audit({ url })` → has_https, has_booking, has_chatbot, quality (none|dead|outdated|poor|decent|good)
   - `pagespeed_score({ url })` → Lighthouse 0-100

**Cas spéciaux** :
- Si le "site" n'est qu'une page Facebook → `has_website: false`, `website_quality: "none"`
- Si le site retourne 404/timeout → `website_quality: "dead"`

## Phase 4 — Social (parallèle, ~10s)

1. `facebook_lookup({ business_name, location })` — facebook_url, instagram_url, follower_count, has_meta_ads, ad_count
2. `websearch({ query: 'site:linkedin.com/in "{owner_name}" {business_name}' })` si owner_name connu — extraire le 1er résultat LinkedIn

## Phase 5 — Score & Save

1. Compute `potential_score` via `lead-scoring` skill
2. Compute `priority_score` (hot/warm/cold) selon score :
   - score >= 80 → hot
   - score 60-79 → warm
   - score < 60 → cold
3. `list_clients({ siren, business_name })` → si match → `skipped: true`, sinon :
4. `save_lead({ ... full payload ... })`

## Format du payload `save_lead`

```yaml
business_name: "..."
description: "..."
address: "..."
phone: "..."
email: "..."
website_url: "..." | null
has_website: true | false
website_quality: "..."
website_score: 0-100
has_https: bool
has_booking: bool
has_chatbot: bool
google_maps_url: "..."
rating: "4.6"
review_count: "320"
review_highlights: ["...", "..."]
facebook_url: "..."
instagram_url: "..."
follower_count: 1234
has_meta_ads: bool
meta_ads_count: 5
linkedin_url: "..."
owner_name: "..."
owner_role: "..."
owner_phone: "..."
owner_email: "..."
siren: "..."
company_type: "SAS"
creation_date: "2018-03-15"
employee_count: "5-10"
revenue_bracket: "500K-1M"
niche: "..."
location: "..."
source: "google_maps|pages_jaunes|web_search"
potential_score: 0-100
priority_score: "hot|warm|cold"
prospect_analysis: "Court résumé 1-2 phrases du potentiel"
identified_need: "Ce qui manque chez eux"
targeted_offer: "Ce qu'on peut leur vendre"
```

## Règles dures

- **Jamais** d'invention. Tout champ inconnu → `null`.
- **Toujours** trace de la source dans `enrichment_data.research_steps`.
- **Sauvegarde par étapes** : appelle `save_lead` avec un partial payload après Phase 1, puis update après chaque phase. Ça évite de tout perdre si timeout.
- **Timebudget** : 90s max par lead. Au-delà, save partial et stop.
