/**
 * Trie (Prefix Tree) Data Structure
 * Used for fast autocomplete and prefix matching of material categories and keywords.
 */
class TrieNode {
  constructor() {
    this.children = {};
    this.isEndOfWord = false;
  }
}

export class Trie {
  constructor() {
    this.root = new TrieNode();
  }

  /**
   * Insert a word/phrase into the Trie
   * @param {string} word 
   */
  insert(word) {
    if (!word || typeof word !== "string") return;
    const cleanWord = word.trim().toLowerCase();
    if (!cleanWord) return;

    let node = this.root;
    for (const char of cleanWord) {
      if (!node.children[char]) {
        node.children[char] = new TrieNode();
      }
      node = node.children[char];
    }
    node.isEndOfWord = true;
  }

  /**
   * Search for an exact word match in the Trie
   * @param {string} word 
   * @returns {boolean} True if word exists
   */
  search(word) {
    if (!word || typeof word !== "string") return false;
    const cleanWord = word.trim().toLowerCase();
    
    let node = this.root;
    for (const char of cleanWord) {
      if (!node.children[char]) return false;
      node = node.children[char];
    }
    return node.isEndOfWord;
  }

  /**
   * Find all words matching the given prefix
   * @param {string} prefix 
   * @returns {string[]} Array of matching words
   */
  autocomplete(prefix) {
    if (prefix === undefined || prefix === null || typeof prefix !== "string") return [];
    const cleanPrefix = prefix.toLowerCase();
    
    let node = this.root;
    for (const char of cleanPrefix) {
      if (!node.children[char]) return [];
      node = node.children[char];
    }

    const results = [];
    this._collectWords(node, cleanPrefix, results);
    return results;
  }

  /**
   * Helper function to recursively collect words from a node
   */
  _collectWords(node, prefix, results) {
    if (node.isEndOfWord) {
      results.push(prefix);
    }
    // Sort keys alphabetically to keep suggestions stable
    const sortedKeys = Object.keys(node.children).sort();
    for (const char of sortedKeys) {
      this._collectWords(node.children[char], prefix + char, results);
    }
  }
}
