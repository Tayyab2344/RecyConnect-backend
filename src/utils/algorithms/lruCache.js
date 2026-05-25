/**
 * Least Recently Used (LRU) Cache
 * Implemented using a Map (for O(1) access) and a Doubly Linked List (for O(1) updates/eviction).
 * Used for caching expensive operations like AI classification queries.
 */
class LinkedListNode {
  constructor(key, value) {
    this.key = key;
    this.value = value;
    this.prev = null;
    this.next = null;
  }
}

export class LRUCache {
  /**
   * @param {number} [capacity=50] - Maximum capacity of the cache
   */
  constructor(capacity = 50) {
    this.capacity = capacity;
    this.cache = new Map(); // Hash map for O(1) node lookup
    
    // Dummy head & tail nodes to avoid null checking
    this.head = new LinkedListNode(null, null);
    this.tail = new LinkedListNode(null, null);
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  /**
   * Get value from cache and mark it as most recently used
   * @param {string} key 
   * @returns {any|null} Cached value or null if miss
   */
  get(key) {
    if (!this.cache.has(key)) return null;

    const node = this.cache.get(key);
    this._moveToHead(node);
    return node.value;
  }

  /**
   * Put value into cache. Evicts LRU item if capacity exceeded.
   * @param {string} key 
   * @param {any} value 
   */
  put(key, value) {
    if (this.cache.has(key)) {
      const node = this.cache.get(key);
      node.value = value;
      this._moveToHead(node);
    } else {
      const newNode = new LinkedListNode(key, value);
      this.cache.set(key, newNode);
      this._addNode(newNode);

      if (this.cache.size > this.capacity) {
        // Evict tail.prev (least recently used)
        const lru = this.tail.prev;
        this._removeNode(lru);
        this.cache.delete(lru.key);
      }
    }
  }

  /**
   * Clear all cached items
   */
  clear() {
    this.cache.clear();
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  // Linked list helpers
  _addNode(node) {
    // Add right after head (most recently used position)
    node.prev = this.head;
    node.next = this.head.next;
    this.head.next.prev = node;
    this.head.next = node;
  }

  _removeNode(node) {
    const prev = node.prev;
    const next = node.next;
    prev.next = next;
    next.prev = prev;
  }

  _moveToHead(node) {
    this._removeNode(node);
    this._addNode(node);
  }
}
