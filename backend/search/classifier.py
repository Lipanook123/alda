"""Classify a URL as 'academic' or 'grey' based on domain and URL patterns.

Source type should reflect the nature of the content, not the API that
fetched it.  A Nature article found via DuckDuckGo is still academic.
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# Known academic publisher / repository domains
# ---------------------------------------------------------------------------
# Checked against the *registered* domain (e.g. "springer.com" matches
# "link.springer.com", "rd.springer.com", etc.).

_ACADEMIC_REGISTERED_DOMAINS: frozenset[str] = frozenset({
    # Large commercial publishers
    "nature.com",
    "springer.com",
    "springeropen.com",
    "biomedcentral.com",
    "sciencedirect.com",
    "elsevier.com",
    "wiley.com",
    "tandfonline.com",
    "sagepub.com",
    "oup.com",          # Oxford University Press
    "cambridge.org",
    "cell.com",
    "thelancet.com",
    "bmj.com",
    "nejm.org",
    "science.org",      # AAAS (Science, Science Advances)
    "sciencemag.org",   # legacy AAAS
    "karger.com",
    "thieme.com",
    "liebertpub.com",
    "iospress.nl",
    "degruyter.com",
    "ingentaconnect.com",
    "wolterskluwer.com",
    "lww.com",          # Lippincott / Wolters Kluwer
    "ovid.com",
    # Open-access publishers
    "plos.org",
    "plosone.org",
    "frontiersin.org",
    "mdpi.com",
    "hindawi.com",
    "peerj.com",
    "f1000research.com",
    "elifesciences.org",
    "jmir.org",
    "cureus.com",
    "pensoft.net",
    "copernicus.org",
    "preprints.org",
    # Society publishers
    "royalsocietypublishing.org",
    "rsc.org",
    "pubs.acs.org",
    "acs.org",
    "aip.org",
    "iop.org",
    "iopscience.iop.org",
    "ieee.org",
    "ieeexplore.ieee.org",
    "acm.org",
    "dl.acm.org",
    "asm.org",
    "aspetjournals.org",
    "faseb.org",
    "rupress.org",
    "physiology.org",
    "jneurosci.org",
    "ahajournals.org",
    "jamanetwork.com",
    "diabetesjournals.org",
    "annals.org",        # Annals of Internal Medicine
    "bloodjournal.org",
    "haematologica.org",
    "thorax.bmj.com",
    "gut.bmj.com",
    # Preprint servers
    "arxiv.org",
    "biorxiv.org",
    "medrxiv.org",
    "chemrxiv.org",
    "psyarxiv.com",
    "osf.io",
    "ssrn.com",
    "eartharxiv.org",
    "engrxiv.org",
    "techrxiv.org",
    # Repositories and databases
    "ncbi.nlm.nih.gov",   # PubMed, PMC
    "nih.gov",
    "pubmed.gov",
    "europepmc.org",
    "cochranelibrary.com",
    "semanticscholar.org",
    "openalex.org",
    "crossref.org",
    "doi.org",
    "researchgate.net",
    "academia.edu",
    "jstor.org",
    "scopus.com",
    "webofscience.com",
    "dimensions.ai",
    "lens.org",
    "core.ac.uk",
    "base-search.net",
    "zenodo.org",
    "figshare.com",
    "dspace.mit.edu",
    "repository.cam.ac.uk",
    "eprints.soton.ac.uk",
    # New sources
    "doaj.org",
    "openaire.eu",
    "scielo.org",
    "scielo.br",
    "scielo.cl",
    "scielo.pt",
    "scielo.mx",
    "scielo.co",
    "scielo.ar",
    "jstage.jst.go.jp",
    "jst.go.jp",
    "cyberleninka.ru",
    "eric.ed.gov",
    "iris.who.int",
    "clinicaltrials.gov",
})

# URL sub-path patterns that strongly indicate an academic article page
# even if the domain isn't in the list above.
_ACADEMIC_PATH_RE = re.compile(
    r"(?:"
    r"/doi/"
    r"|doi\.org/"
    r"|/article/"
    r"|/articles/"
    r"|/abstract/"
    r"|/full(?:text|paper)/"
    r"|/pmc/articles/"
    r"|[?&]pmid="
    r"|[?&]doi="
    r")",
    re.IGNORECASE,
)


def _registered_domain(hostname: str) -> str:
    """Return the registered domain (last two labels) of a hostname."""
    # Strip www. / subdomain noise — keep last two labels.
    # e.g.  "link.springer.com" → "springer.com"
    #        "ncbi.nlm.nih.gov" → "nih.gov" ... but we want to match
    # "ncbi.nlm.nih.gov" as a whole too.
    # Strategy: check the full hostname first, then progressively strip.
    parts = hostname.split(".")
    # Build candidates from most-specific to least-specific registered domain
    # e.g. ["ncbi.nlm.nih.gov", "nlm.nih.gov", "nih.gov"]
    candidates = [".".join(parts[i:]) for i in range(max(0, len(parts) - 4), len(parts) - 1)]
    return candidates  # caller checks all


def classify_url(url: str) -> str:
    """Return 'academic' or 'grey' for a given URL."""
    if not url:
        return "grey"
    try:
        parsed = urlparse(url if "://" in url else "https://" + url)
        hostname = (parsed.hostname or "").lower().lstrip("www.")

        # Check hostname candidates against known academic domains
        for candidate in _registered_domain(hostname):
            if candidate in _ACADEMIC_REGISTERED_DOMAINS:
                return "academic"

        # .edu / .edu.XX / .ac.XX domains are university sites
        if (hostname.endswith(".edu")
                or re.search(r"\.edu\.[a-z]{2}$", hostname)
                or re.search(r"\.ac\.[a-z]{2}$", hostname)):
            return "academic"

        # Path-based patterns (DOI links, PMC, etc.)
        full = (parsed.path + "?" + (parsed.query or "")).lower()
        if _ACADEMIC_PATH_RE.search(full) or _ACADEMIC_PATH_RE.search(url.lower()):
            return "academic"

    except Exception:
        pass

    return "grey"
