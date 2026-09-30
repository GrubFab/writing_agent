"""
Author Style Database & Prompt Synthesizer for Writing Agent.

Provides a curated database of author narrative benchmarks and craft styles,
allowing novelists to pick and mix up to 6 authors to tailor the agent's
editorial critiques, dialogue coaching, and stylistic propositions.
"""

import json
from pathlib import Path
from typing import Dict, List, Optional

CONFIG_DIR = Path.home() / ".writing_agent"
CUSTOM_AUTHORS_FILE = CONFIG_DIR / "custom_authors.json"

# Curated reference database of authors
BUILTIN_AUTHORS: Dict[str, dict] = {
    "connelly": {
        "id": "connelly",
        "name": "Michael Connelly",
        "genre": "Procedural Crime / Legal Thriller (Bosch / Haller)",
        "tagline": "Terse observational economy & procedural realism",
        "description": "Terse observational economy, gritty procedural realism, lean and muscular prose, razor-sharp authentic dialogue, relentless investigative momentum, and unadorned atmospheric details of urban reality and institutional bureaucracy.",
        "dialogue_traits": "Spare, direct, authentic tradecraft questions; characters speak like real investigators and street operators without theatrical flourishes or melodrama.",
        "pacing_traits": "Relentless, disciplined forward momentum; focus on sensory observation, tangible logistics, and physical deduction over internal navel-gazing."
    },
    "clancy": {
        "id": "clancy",
        "name": "Tom Clancy",
        "genre": "Military / Geopolitical Techno-Thriller (Jack Ryan)",
        "tagline": "Operational authenticity & tactical precision",
        "description": "Meticulous operational and technical accuracy, military and intelligence authenticity, sweeping geopolitical stakes grounded in tactical minutiae, brisk pragmatic pacing, and professional matter-of-fact dialogue among operators.",
        "dialogue_traits": "Professional, composed, authentic military/agency shorthand; characters sound like competent practitioners making high-stakes decisions under pressure.",
        "pacing_traits": "Dual-track pacing: expansive macro-strategic stakes cross-cut with clockwork tactical execution; clear cause-and-effect logistics."
    },
    "crichton": {
        "id": "crichton",
        "name": "Michael Crichton",
        "genre": "Scientific Techno-Thriller / Bio-Thriller",
        "tagline": "Lucid scientific verisimilitude & escalating tension",
        "description": "High-concept techno-thriller pacing, clinical tension, plausible scientific extrapolation, lucid explanatory clarity, and brisk cinematic urgency examining systemic dilemmas of cutting-edge technology.",
        "dialogue_traits": "Sharp, intellectually combative, lucid explanations; scientists and executives speaking with high-stakes urgency and professional clarity.",
        "pacing_traits": "Rapid, escalating suspense; complex systems failing under stress; documentary-like realism with page-turning momentum."
    },
    "suarez": {
        "id": "suarez",
        "name": "Daniel Suarez",
        "genre": "Near-Future Cyber & Autonomous Systems Thriller",
        "tagline": "High-tech realism & visceral cinematic propulsion",
        "description": "Cutting-edge technological realism (AI, autonomous systems, cyber warfare, robotics, decentralized networks), visceral cinematic action scenes, and hyper-competent protagonists navigating automated threats.",
        "dialogue_traits": "Modern, crisp, technologically fluent; concise communication under active threat; engineers and tacticians solving emergent problems in real time.",
        "pacing_traits": "Kinetic, modern propulsion; vivid spatial awareness in action sequences; seamlessly woven technical verisimilitude."
    },
    "robinson": {
        "id": "robinson",
        "name": "Kim Stanley Robinson",
        "genre": "Hard Science Fiction / Systemic Realism",
        "tagline": "Deep systemic verisimilitude & textured world-building",
        "description": "Deep systemic realism, scientific and ecological verisimilitude, patient textured world-building, sociopolitical authenticity, and institutional dynamics without melodramatic shortcuts.",
        "dialogue_traits": "Thoughtful, articulate, grounded in institutional and ideological nuance; characters debate policy, science, and survival with human depth.",
        "pacing_traits": "Layered, immersive scene construction; rich physical textures of landscape, geology, and technology; authentic long-horizon stakes."
    },
    "lehane": {
        "id": "lehane",
        "name": "Dennis Lehane",
        "genre": "Psychological Neo-Noir / Character Crime Drama",
        "tagline": "Rhythmic gritty dialogue & moral gravity",
        "description": "Haunting emotional weight, gritty rhythmic dialogue, moral ambiguity, and atmospheric sense of place, trauma, and working-class reality.",
        "dialogue_traits": "Rhythmic, punchy, laced with subtext, dark wit, and street cadence; voices distinctive and scarred by history.",
        "pacing_traits": "Character-driven pressure cooker; mounting psychological tension; deeply felt human consequences for every action."
    },
    "lecarre": {
        "id": "lecarre",
        "name": "John le Carré",
        "genre": "Espionage / Cold War Intelligence Tradecraft",
        "tagline": "Deceptive understatement & tradecraft subtext",
        "description": "Deceptive understatement, subtle tradecraft and bureaucratic tension, psychological nuance, dry irony, and spoken dialogue where what is unsaid matters more than what is spoken.",
        "dialogue_traits": "Elliptical, civilized on the surface, devastating underneath; layered with bureaucratic doublespeak, veiled threats, and silence.",
        "pacing_traits": "Deliberate, atmospheric cat-and-mouse tension; rooms where quiet conversations decide life, death, and nations."
    },
    "gibson": {
        "id": "gibson",
        "name": "William Gibson",
        "genre": "Cyberpunk / Modern Speculative Thriller",
        "tagline": "Poetic compression & cutting-edge sensory texture",
        "description": "Poetic compression, cutting-edge sensory metaphors, cool detached tone, dense evocative street/cyber vernacular, and sensory texture of high technology colliding with human nature.",
        "dialogue_traits": "Cool, clipped, highly stylish yet economically spoken; effortless subcultural slang and jargon.",
        "pacing_traits": "Visceral, atmospheric, fragmented sensory immersion; every sentence carries rich stylistic payload."
    },
    "rollins": {
        "id": "rollins",
        "name": "James Rollins",
        "genre": "Action-Adventure Scientific Mystery (Sigma Force)",
        "tagline": "High-velocity cliffhangers & kinetic adventure",
        "description": "High-velocity chapter cliffhangers, science-meets-history enigmas, energetic kinetic set pieces, and accessible, breathless thriller pacing.",
        "dialogue_traits": "Snappy, high-adrenaline, camaraderie-driven banter balanced with quick tactical calls.",
        "pacing_traits": "Breakneck velocity; frequent perspective shifts; pulse-pounding set-piece progression."
    },
    "king": {
        "id": "king",
        "name": "Stephen King",
        "genre": "Grounded Suspense / Supernatural Thriller",
        "tagline": "Intimate conversational voice & tactile Americana",
        "description": "Intimate conversational narrative voice, tactile grounded Americana, rich colloquial dialogue, deep psychological suspense, and relatable visceral reactions.",
        "dialogue_traits": "Earthy, highly colloquial, deeply personal and idiomatic; characters talk like real people with idiosyncratic speech habits.",
        "pacing_traits": "Slow-burn psychological dread punctuated by visceral shocks; deep immersion in character sensory details."
    },
    "herbert": {
        "id": "herbert",
        "name": "Frank Herbert",
        "genre": "Epic Speculative / Political & Ecological Intrigue",
        "tagline": "Subtextual power dynamics & ritualistic depth",
        "description": "Multi-layered internal monologues, intense subtextual power dynamics, philosophical and ecological depth, and ritualistic narrative weight.",
        "dialogue_traits": "Calculated, multi-layered; every spoken exchange is a chess match of observation and political leverage.",
        "pacing_traits": "Tense, ritualistic, high-stakes momentum; immense scope balanced by microscopic behavioral observation."
    },
    "christie": {
        "id": "christie",
        "name": "Agatha Christie",
        "genre": "Classic Mystery / Whodunit & Deduction",
        "tagline": "Clean puzzle mechanics & psychological misdirection",
        "description": "Deceptively clean puzzle mechanics, economical character sketching, dialogue packed with subtle clues, and sharp psychological deduction.",
        "dialogue_traits": "Polite, sharp-witted, laden with understated social cues, contradictions, and psychological reveals.",
        "pacing_traits": "Crisp, methodical revelation; elegant structural economy with zero wasted motion."
    }
}

DEFAULT_STYLE_IDS: List[str] = ["connelly", "clancy", "crichton", "suarez", "robinson"]


def load_custom_authors() -> Dict[str, dict]:
    """Load user-defined custom authors from ~/.writing_agent/custom_authors.json."""
    if not CUSTOM_AUTHORS_FILE.exists():
        return {}
    try:
        data = json.loads(CUSTOM_AUTHORS_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


def save_custom_author(name: str, description: str, genre: str = "Custom / Hybrid", tagline: str = "") -> dict:
    """Save a user-defined custom author to local config."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    custom = load_custom_authors()
    
    # Generate clean ID
    import re
    author_id = re.sub(r"[^a-zA-Z0-9]+", "_", name.strip().lower()).strip("_")
    if not author_id:
        author_id = "custom_author"
        
    author_obj = {
        "id": author_id,
        "name": name.strip(),
        "genre": genre.strip() or "Custom / Hybrid",
        "tagline": tagline.strip() or description.strip()[:60] + "...",
        "description": description.strip(),
        "dialogue_traits": "Grounded, character-specific dialogue consistent with the author's defined voice.",
        "pacing_traits": "Consistent with the author's target narrative momentum.",
        "is_custom": True,
    }
    
    custom[author_id] = author_obj
    CUSTOM_AUTHORS_FILE.write_text(json.dumps(custom, indent=2), encoding="utf-8")
    return author_obj


def delete_custom_author(author_id: str) -> bool:
    """Delete a user-defined custom author."""
    custom = load_custom_authors()
    if author_id in custom:
        del custom[author_id]
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        CUSTOM_AUTHORS_FILE.write_text(json.dumps(custom, indent=2), encoding="utf-8")
        return True
    return False


def get_all_authors() -> Dict[str, dict]:
    """Return dictionary of all available authors (built-in + custom)."""
    authors = dict(BUILTIN_AUTHORS)
    custom = load_custom_authors()
    authors.update(custom)
    return authors


def resolve_authors(author_ids: Optional[List[str]]) -> List[dict]:
    """Resolve a list of author IDs (up to 6) to author objects."""
    all_authors = get_all_authors()
    if not author_ids:
        author_ids = DEFAULT_STYLE_IDS
    
    # Cap at 6 authors max
    capped_ids = [aid.strip().lower() for aid in author_ids if aid.strip()][:6]
    
    resolved = []
    for aid in capped_ids:
        if aid in all_authors:
            resolved.append(all_authors[aid])
        else:
            # Fallback for unrecognized name
            resolved.append({
                "id": aid,
                "name": aid.replace("_", " ").title(),
                "genre": "Reference Author",
                "tagline": "Custom reference style",
                "description": f"Narrative craft informed by the techniques and pacing of {aid.replace('_', ' ').title()}.",
                "dialogue_traits": "Authentic, spoken, and character-driven.",
                "pacing_traits": "Disciplined and purposeful."
            })
    return resolved


def build_style_prompt(author_ids: Optional[List[str]]) -> str:
    """
    Build the editorial style guide instruction for the LLM prompt based
    on the selected blend of reference authors (max 6).
    """
    authors = resolve_authors(author_ids)
    if not authors:
        return ""
    
    names = ", ".join(a["name"] for a in authors)
    
    lines = [
        "AUTHOR EDITORIAL STYLE DNA & BENCHMARKS:",
        f"The author crafts their work with reference to the following aesthetic blend (as craft benchmarks, NOT for plagiarism or imitation):",
        f"Target Reference Blend: {names}\n"
    ]
    
    for a in authors:
        lines.append(f"- **{a['name']}** ({a.get('genre', '')}): {a.get('description', '')}")
    
    lines.append("\nEDITORIAL CRAFT GUIDELINES FOR THIS BLEND:")
    lines.append("1. Dialogue Authenticity ('Cibliste' / Spoken Vernacular):")
    lines.append("   - Characters must sound like seasoned professionals, operators, and real people, NOT stage actors or literary narrators.")
    lines.append("   - Use natural oral syntax, functional vocabulary, authentic tradecraft/technical terms, and spoken contractions.")
    lines.append("   - Eliminate stilted bookish exposition, flowery banter, melodrama, or unnatural speech tags.")
    lines.append("2. Prose & Observation:")
    lines.append("   - Lean, muscular, observant prose. Emphasize physical texture, technical accuracy, logistics, and atmospheric realism.")
    lines.append("   - Avoid purple prose, repetitive emotional qualifiers, and unearned exposition.")
    lines.append("3. Editorial Propositions:")
    lines.append("   - When offering dialogue coaching or prose polish, shape your suggestions to reflect this specific blend: terse, technically grounded, propulsive, and perceptively realistic.")
    
    return "\n".join(lines)


def build_language_instruction(language: str = "en") -> str:
    """Build the language instruction for the LLM prompt."""
    lang_code = (language or "en").lower().strip()
    
    if lang_code in ("fr", "français", "french"):
        return """LANGUAGE MANDATE:
You MUST output ALL generated content values in literary, natural Français (French).
- The chapter summary, character update descriptions, timeline event descriptions, thread notes, and continuity flags MUST be written in French.
- All editorial critiques, style assessments, prose proposals, and dialogue coaching MUST be written in French.
- Strictly adhere to 'cibliste plutôt que sourcier': use natural, spoken, and authentic French idioms, natural oral rhythm, avoiding calques of English expressions, literal translations, or stiff bookish formulations.
- Note: Keep JSON schema keys in English (e.g. 'summary', 'pov_character', 'editorial_suggestions'), but every string value inside the JSON MUST be in French."""

    elif lang_code in ("pt", "português", "portuguese"):
        return """LANGUAGE MANDATE:
You MUST output ALL generated content values in natural, polished Português (Portuguese).
- The chapter summary, character update descriptions, timeline event descriptions, thread notes, and continuity flags MUST be written in Portuguese.
- All editorial critiques, style assessments, prose proposals, and dialogue coaching MUST be written in Portuguese.
- Dialogue coaching must reflect authentic spoken Portuguese ('cibliste'), natural speech cadence, idiomatic colloquial richness, and avoid literal translation or unnatural bookish phrasing.
- Note: Keep JSON schema keys in English (e.g. 'summary', 'pov_character', 'editorial_suggestions'), but every string value inside the JSON MUST be in Portuguese."""

    elif lang_code in ("auto", "detect"):
        return """LANGUAGE MANDATE:
Automatically detect the primary language of the chapter draft (e.g., English, French, Portuguese). Output all summaries, character updates, timeline events, thread notes, continuity flags, and editorial critique/propositions in that EXACT same language, adhering to authentic, natural oral and literary standards of that language."""

    else:  # Default English
        return """LANGUAGE MANDATE:
Output all generated text values in natural, polished English, focusing on authentic spoken dialogue, crisp observational prose, and idiomatic flow."""
