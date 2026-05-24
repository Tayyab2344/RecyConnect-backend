/**
 * Binary Heap based Priority Queue.
 * Allows items with higher priority numerical values to be dequeued first.
 * Useful for task scheduling and notification dispatch prioritization.
 */
export class PriorityQueue {
  /**
   * @param {function} [comparator] - Function to determine element order.
   * By default, it orders by priority descending (Max-Heap).
   */
  constructor(comparator = (a, b) => b.priority - a.priority) {
    this.heap = [];
    this.comparator = comparator;
  }

  /**
   * Get queue size
   * @returns {number}
   */
  size() {
    return this.heap.length;
  }

  /**
   * Check if queue is empty
   * @returns {boolean}
   */
  isEmpty() {
    return this.heap.length === 0;
  }

  /**
   * Peek at the highest-priority element without removing it
   * @returns {any|null}
   */
  peek() {
    return this.isEmpty() ? null : this.heap[0].item;
  }

  /**
   * Enqueue an item with a priority score
   * @param {any} item 
   * @param {number} priority 
   */
  enqueue(item, priority) {
    const element = { item, priority };
    this.heap.push(element);
    this._bubbleUp(this.heap.length - 1);
  }

  /**
   * Dequeue and return the highest-priority item
   * @returns {any|null}
   */
  dequeue() {
    if (this.isEmpty()) return null;
    const top = this.heap[0].item;
    const bottom = this.heap.pop();
    
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this._sinkDown(0);
    }
    
    return top;
  }

  _bubbleUp(index) {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      // If parent is already higher/equal priority, stop
      if (this.comparator(this.heap[index], this.heap[parentIndex]) >= 0) {
        break;
      }
      this._swap(index, parentIndex);
      index = parentIndex;
    }
  }

  _sinkDown(index) {
    const length = this.heap.length;
    while (true) {
      let leftChildIndex = 2 * index + 1;
      let rightChildIndex = 2 * index + 2;
      let swapIndex = null;

      if (leftChildIndex < length) {
        if (this.comparator(this.heap[leftChildIndex], this.heap[index]) < 0) {
          swapIndex = leftChildIndex;
        }
      }

      if (rightChildIndex < length) {
        if (
          (swapIndex === null && this.comparator(this.heap[rightChildIndex], this.heap[index]) < 0) ||
          (swapIndex !== null && this.comparator(this.heap[rightChildIndex], this.heap[leftChildIndex]) < 0)
        ) {
          swapIndex = rightChildIndex;
        }
      }

      if (swapIndex === null) {
        break;
      }

      this._swap(index, swapIndex);
      index = swapIndex;
    }
  }

  _swap(i, j) {
    const temp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = temp;
  }
}
