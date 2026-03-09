"""Canonical stopwords shared by indexing and query processing."""
from __future__ import annotations

STOPWORDS: frozenset[str] = frozenset({
    "a", "an", "and", "are", "as", "asked", "at",
    "be", "by",
    "did", "do", "does",
    "for", "from",
    "give", "given",
    "how",
    "i", "in", "is", "it", "its",
    "me", "my",
    "of", "on", "or", "our",
    "that", "the", "their", "them", "they", "this", "to",
    "up", "us",
    "was", "we", "what", "when", "where", "which", "who", "why", "with",
    "you", "your",
})
