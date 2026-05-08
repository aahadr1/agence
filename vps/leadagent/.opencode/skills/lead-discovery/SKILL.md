---
name: lead-discovery
description: |
  Comment trouver de nouveaux leads B2B en France à partir d'un ICP (niche + ville).
  Utilise quand Aaron demande "trouve-moi N entreprises de [niche] à [ville]" ou
  "explore [zone] pour [type de business]".
metadata:
  workflow: lead-gen
  audience: agence-aaron
---

# Lead Discovery — playbook

## Inputs attendus

- `niche` : ex "restaurant", "salon de coiffure", "boulangerie", "garage auto"
- `location` : ville française (avec ou sans CP)
- `volume_target` : combien de leads cibles (10, 50, 200...)
- `criteria` (optionnel) : ex "sans site web", "petit (< 5 employés)", "récent (< 3 ans)"

## Stratégie en 3 vagues

### Vague 1 — Google Maps (le plus efficace)

`google_maps_scrape({ query: "{niche} {location}", max_results: 30 })`

Variantes de query à essayer si la première sature :
- `"{niche} {location}"` (de base)
- `"meilleur {niche} {location}"`
- `"{niche} {arrondissement de location}"` — décompose si grosse ville
- Synonymes locaux : "bistro" ≈ "restaurant", "coiffeur" ≈ "salon de coiffure", "carrossier" ≈ "garage"

Récolte par lead :
- Nom, adresse, téléphone (si visible)
- URL Google Maps (canonique)
- Site web (si présent — souvent absent ou redirect)
- Note + nb d'avis
- Catégorie

### Vague 2 — Pages Jaunes (complément, surtout artisans)

Pour les niches artisanales, PJ a souvent plus de complétude que Google Maps.

`pages_jaunes_search({ query: "{niche}", location })` puis pour chaque résultat manquant en Maps, ajouter au pool.

### Vague 3 — Web search (long tail)

Pour les niches ultra-spécifiques (ex "studio yoga prénatal"), `websearch` avec :

- `"{niche} {location} avis"` — souvent trouve des forums, blogs, presse locale
- `site:facebook.com {niche} {location}` — trouve les pages FB
- `"{niche} {location}" -avis -inurl:tripadvisor` — exclut les agrégateurs

## Filtrage côté agent

Avant de passer à l'enrichissement :

1. **Dédoublonnage** :
   - Sur le nom canonique (lowercase, sans accents, sans suffixes "SARL/SAS/etc.")
   - Sur le téléphone
   - Sur l'URL Maps si présente
2. **list_clients** : retire ceux déjà dans la base (par SIREN ou nom+ville)
3. **Critères de l'ICP** :
   - "sans site web" → garde ceux dont `website_url` est null OU pointe vers une page Facebook
   - "petit" → cherche le SIREN puis filtre par `employee_count` < 5 (étape 2 — enrichissement)
   - "récent" → idem, filtre par `creation_date`

## Output attendu

Une liste de candidats (objets) à passer à `enricher` :

```yaml
- business_name: "Le Bouchon Lyonnais"
  location: "Lyon 2e"
  google_maps_url: "https://maps.google.com/..."
  phone: "+33 4 78 ..."
  rating: 4.6
  review_count: 800
  website_url: null
  source: "google_maps"

- business_name: ...
```

## Erreurs courantes

- **Google Maps blocked** : si CAPTCHA, attend 30s et retry une fois. Sinon switch sur PJ.
- **Trop de résultats touristiques** : ajoute "-tripadvisor -thefork" dans la query
- **Volume insuffisant** : élargis la zone (ex Lyon → Lyon métropole) ou la niche (restaurant → restauration)

## Budget par run

- Cible 50 leads → ~5-10 min de scraping + ~2-3 min de filtrage
- Cible 500 leads → délègue par batchs de 50 à plusieurs `task` parallèles
