import { Trie } from "../utils/algorithms/trie.js";
import prisma from "../lib/prisma.js";
import { logger } from "../utils/logger.js";

const trieInstance = new Trie();

/**
 * Loads all unique material types, categories, and titles into the Trie.
 */
export async function initializeTrie() {
  try {
    logger.info("[TRIE] Initializing and loading search keywords...");
    
    // Fetch active listings
    const listings = await prisma.listing.findMany({
      where: { status: "PUBLISHED" },
      select: { materialType: true, category: true, title: true }
    });

    const keywords = new Set();

    // Seed default common categories/materials
    const defaultKeywords = [
      "plastic", "plastic bottles", "plastic containers", "pet bottles", "plastic caps",
      "paper", "cardboard", "newspaper", "office paper", "cartons",
      "metal", "aluminum", "aluminum cans", "iron scrap", "copper wire", "brass",
      "glass", "glass bottles", "glass jars", "broken glass",
      "e-waste", "battery", "lithium battery", "electronics", "computer parts", "mobile phones",
      "organic", "compost", "wood", "rubber", "tyres"
    ];

    for (const keyword of defaultKeywords) {
      keywords.add(keyword);
    }

    for (const l of listings) {
      if (l.materialType) keywords.add(l.materialType);
      if (l.category) keywords.add(l.category);
      if (l.title) {
        keywords.add(l.title);
        // Split title into words and add individual keywords
        const parts = l.title.split(/\s+/);
        for (const p of parts) {
          const clean = p.replace(/[^a-zA-Z]/g, "").toLowerCase();
          if (clean.length > 2) {
            keywords.add(clean);
          }
        }
      }
    }

    for (const word of keywords) {
      trieInstance.insert(word);
    }

    logger.info(`[TRIE] Loaded ${keywords.size} autocomplete keywords successfully.`);
  } catch (err) {
    logger.error(`[TRIE] Initialization failed: ${err.message}`);
  }
}

/**
 * Returns the global Trie instance
 */
export function getTrie() {
  return trieInstance;
}

/**
 * Insert new listing information dynamically into the Trie
 */
export function addWordsFromListing(listing) {
  if (!listing) return;
  try {
    if (listing.materialType) trieInstance.insert(listing.materialType);
    if (listing.category) trieInstance.insert(listing.category);
    if (listing.title) {
      trieInstance.insert(listing.title);
      const parts = listing.title.split(/\s+/);
      for (const p of parts) {
        const clean = p.replace(/[^a-zA-Z]/g, "").toLowerCase();
        if (clean.length > 2) {
          trieInstance.insert(clean);
        }
      }
    }
  } catch (err) {
    logger.error(`[TRIE] Error dynamically inserting words: ${err.message}`);
  }
}

/**
 * Get prefix suggestions from Trie
 * @param {string} prefix 
 * @returns {string[]} Matching words
 */
export function autocompleteSearch(prefix) {
  return trieInstance.autocomplete(prefix);
}
