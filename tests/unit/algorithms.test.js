import { Trie } from "../../src/utils/algorithms/trie.js";
import { PriorityQueue } from "../../src/utils/algorithms/priorityQueue.js";
import { LRUCache } from "../../src/utils/algorithms/lruCache.js";
import { KDTree, getHaversineDistance } from "../../src/utils/algorithms/kdTree.js";
import { aStarPathfind, solveTSP } from "../../src/utils/algorithms/router.js";

describe("Algorithm Unit Tests", () => {
  describe("Trie Search Autocomplete", () => {
    test("should insert and autocomplete words correctly", () => {
      const trie = new Trie();
      trie.insert("plastic");
      trie.insert("plastic bottles");
      trie.insert("paper");
      
      expect(trie.search("plastic")).toBe(true);
      expect(trie.search("paper")).toBe(true);
      expect(trie.search("glass")).toBe(false);
      
      const suggestions = trie.autocomplete("pla");
      expect(suggestions).toContain("plastic");
      expect(suggestions).toContain("plastic bottles");
      expect(suggestions).not.toContain("paper");
    });
  });

  describe("Heap-based Priority Queue", () => {
    test("should dequeue elements in descending order of priority", () => {
      const pq = new PriorityQueue();
      pq.enqueue("Low Task", 1);
      pq.enqueue("High Task", 3);
      pq.enqueue("Medium Task", 2);
      
      expect(pq.size()).toBe(3);
      expect(pq.peek()).toBe("High Task");
      expect(pq.dequeue()).toBe("High Task");
      expect(pq.dequeue()).toBe("Medium Task");
      expect(pq.dequeue()).toBe("Low Task");
      expect(pq.isEmpty()).toBe(true);
    });
  });

  describe("LRU Cache", () => {
    test("should store and evict least recently used entries", () => {
      const cache = new LRUCache(3);
      cache.put("a", 1);
      cache.put("b", 2);
      cache.put("c", 3);
      
      expect(cache.get("a")).toBe(1); // Marks 'a' as MRU
      cache.put("d", 4); // Evicts 'b' (LRU is 'b')
      
      expect(cache.get("b")).toBeNull();
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
      expect(cache.get("a")).toBe(1);
    });
  });

  describe("KD-Tree Spatial Indexing", () => {
    test("should find the nearest coordinate neighbor correctly", () => {
      const points = [
        { id: 1, latitude: 31.4015, longitude: 74.2405 }, // Node A
        { id: 2, latitude: 31.5000, longitude: 74.3000 }, // Node B
        { id: 3, latitude: 31.2000, longitude: 74.1000 }  // Node C
      ];
      
      const tree = new KDTree(points);
      const target = { latitude: 31.4020, longitude: 74.2410 };
      const nearest = tree.nearest(target);
      
      expect(nearest).toBeDefined();
      expect(nearest.id).toBe(1);
      
      const distance = getHaversineDistance(target, { latitude: nearest.latitude, longitude: nearest.longitude });
      expect(distance).toBeLessThan(0.5); // Very close (less than 500m)
    });
  });

  describe("A* Pathfinder and TSP Routing", () => {
    test("should solve TSP sequence correctly", () => {
      const start = { latitude: 31.4015, longitude: 74.2405 }; // Gate
      const tasks = [
        { id: 1, sourceLatitude: 31.4080, sourceLongitude: 74.2530 }, // Far WAPDA town
        { id: 2, sourceLatitude: 31.4050, sourceLongitude: 74.2420 }  // Close Junction A
      ];
      
      const result = solveTSP(start, tasks);
      expect(result.sequence).toBeDefined();
      expect(result.sequence.length).toBe(2);
      // The greedy solver should visit the closest one first (Junction A -> ID 2)
      expect(result.sequence[0].id).toBe(2);
      expect(result.sequence[1].id).toBe(1);
    });

    test("should run A* pathfinding successfully on simulated grid", () => {
      const pathResult = aStarPathfind(0, 3); // Path from gate to Thokar Niaz Baig
      expect(pathResult).toBeDefined();
      expect(pathResult.distance).toBeGreaterThan(0);
      expect(pathResult.path[0].id).toBe(0);
      expect(pathResult.path[pathResult.path.length - 1].id).toBe(3);
    });
  });
});
