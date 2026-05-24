import { getHaversineDistance } from "./kdTree.js";
import { PriorityQueue } from "./priorityQueue.js";

// Simulated road network graph in Lahore (COMSATS University area)
export const CITY_MAP_NODES = [
  { id: 0, latitude: 31.4015, longitude: 74.2405, name: "COMSATS University Gate" },
  { id: 1, latitude: 31.4050, longitude: 74.2420, name: "Junction A (Ali Town Road)" },
  { id: 2, latitude: 31.4080, longitude: 74.2450, name: "Junction B (Raiwind Road)" },
  { id: 3, latitude: 31.4110, longitude: 74.2400, name: "Thokar Niaz Baig Interchange" },
  { id: 4, latitude: 31.3980, longitude: 74.2450, name: "Valencia Town Gate" },
  { id: 5, latitude: 31.4020, longitude: 74.2500, name: "Khayaban-e-Jinnah Junction" },
  { id: 6, latitude: 31.4080, longitude: 74.2530, name: "WAPDA Town Roundabout" },
  { id: 7, latitude: 31.3910, longitude: 74.2480, name: "Valencia Central Square" },
  { id: 8, latitude: 31.3850, longitude: 74.2420, name: "Valencia D-Block Ring Road" },
  { id: 9, latitude: 31.3950, longitude: 74.2600, name: "OPF Society Crossing" }
];

// Bidirectional connections between intersections
const ROAD_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [0, 4], [4, 7], [7, 8], [4, 5], [5, 6], [2, 6], [5, 9], [7, 9]
];

// Build adjacency list with weight (Haversine distance in km)
const ADJACENCY_LIST = {};
for (const node of CITY_MAP_NODES) {
  ADJACENCY_LIST[node.id] = [];
}

for (const [u, v] of ROAD_CONNECTIONS) {
  const nodeU = CITY_MAP_NODES[u];
  const nodeV = CITY_MAP_NODES[v];
  const distance = getHaversineDistance(nodeU, nodeV);

  // Store neighbor and distance weight
  ADJACENCY_LIST[u].push({ neighborId: v, weight: distance });
  ADJACENCY_LIST[v].push({ neighborId: u, weight: distance });
}

/**
 * Finds the closest node on the map graph to a given coordinate.
 */
export function findNearestMapNode(latitude, longitude) {
  let nearestNode = null;
  let minDistance = Infinity;

  for (const node of CITY_MAP_NODES) {
    const dist = getHaversineDistance({ latitude, longitude }, node);
    if (dist < minDistance) {
      minDistance = dist;
      nearestNode = node;
    }
  }

  return nearestNode;
}

/**
 * A* Pathfinding Algorithm
 * Finds the shortest path between two nodes in the simulated road network.
 * Uses Haversine distance to the target node as the heuristic function (h).
 * 
 * @param {number} startId 
 * @param {number} endId 
 * @returns {Object|null} Path nodes and total distance
 */
export function aStarPathfind(startId, endId) {
  const endNode = CITY_MAP_NODES.find(n => n.id === endId);
  if (!endNode) return null;

  // Priority Queue stores nodes sorted by f = g + h score descending (Max-Heap comparator logic reversed)
  const openSet = new PriorityQueue((a, b) => a.f - b.f);
  const closedSet = new Set();

  const gScore = {}; // Cost from start node to current node
  const fScore = {}; // gScore + heuristic
  const cameFrom = {}; // Path reconstruction map

  for (const node of CITY_MAP_NODES) {
    gScore[node.id] = Infinity;
    fScore[node.id] = Infinity;
  }

  gScore[startId] = 0;
  const hStart = getHaversineDistance(CITY_MAP_NODES.find(n => n.id === startId), endNode);
  fScore[startId] = hStart;

  openSet.enqueue(startId, hStart);

  while (!openSet.isEmpty()) {
    const currentId = openSet.dequeue();

    if (currentId === endId) {
      // Reconstruct path
      const path = [];
      let temp = currentId;
      while (temp !== undefined) {
        path.push(CITY_MAP_NODES.find(n => n.id === temp));
        temp = cameFrom[temp];
      }
      return {
        path: path.reverse(),
        distance: gScore[endId]
      };
    }

    closedSet.add(currentId);

    for (const edge of ADJACENCY_LIST[currentId]) {
      const neighborId = edge.neighborId;
      if (closedSet.has(neighborId)) continue;

      const tentativeGScore = gScore[currentId] + edge.weight;

      if (tentativeGScore < gScore[neighborId]) {
        cameFrom[neighborId] = currentId;
        gScore[neighborId] = tentativeGScore;
        const h = getHaversineDistance(CITY_MAP_NODES.find(n => n.id === neighborId), endNode);
        fScore[neighborId] = tentativeGScore + h;

        openSet.enqueue(neighborId, tentativeGScore + h);
      }
    }
  }

  return null; // No path found
}

/**
 * Resolves a full route from any arbitrary coordinates to another using the road network.
 * 
 * @param {Object} startCoords - { latitude, longitude }
 * @param {Object} endCoords - { latitude, longitude }
 * @returns {Object} Route geometry points and total distance
 */
export function getRoute(startCoords, endCoords) {
  const startNode = findNearestMapNode(startCoords.latitude, startCoords.longitude);
  const endNode = findNearestMapNode(endCoords.latitude, endCoords.longitude);

  const startToNodeDist = getHaversineDistance(startCoords, startNode);
  const nodeToEndDist = getHaversineDistance(endNode, endCoords);

  if (startNode.id === endNode.id) {
    return {
      coordinates: [startCoords, startNode, endCoords],
      totalDistance: getHaversineDistance(startCoords, endCoords)
    };
  }

  const networkPath = aStarPathfind(startNode.id, endNode.id);

  if (!networkPath) {
    // Fallback to straight line if graph search fails
    return {
      coordinates: [startCoords, endCoords],
      totalDistance: getHaversineDistance(startCoords, endCoords)
    };
  }

  const coordinates = [
    startCoords,
    ...networkPath.path,
    endCoords
  ];

  return {
    coordinates,
    totalDistance: startToNodeDist + networkPath.distance + nodeToEndDist
  };
}

/**
 * Traveling Salesman Problem (TSP) Solver
 * Solves the routing sequence for a collector starting from their location
 * and visiting multiple pickup/destination tasks.
 * Uses a Greedy Nearest-Neighbor heuristic ($O(V^2)$).
 * 
 * @param {Object} startCoords - Collector's starting position { latitude, longitude }
 * @param {Object[]} tasks - Array of task objects, each containing location coordinates
 * @returns {Object} Optimized task sequence, route path coordinates, and total distance
 */
export function solveTSP(startCoords, tasks) {
  if (!tasks || tasks.length === 0) {
    return { sequence: [], routePoints: [startCoords], totalDistance: 0 };
  }

  const unvisited = [...tasks];
  const sequence = [];
  let currentCoords = { ...startCoords };
  let totalDistance = 0;
  const routePoints = [startCoords];

  while (unvisited.length > 0) {
    let bestIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const task = unvisited[i];
      // Use source location for routing
      const taskCoords = {
        latitude: task.sourceLatitude || startCoords.latitude,
        longitude: task.sourceLongitude || startCoords.longitude
      };
      
      const dist = getHaversineDistance(currentCoords, taskCoords);
      if (dist < minDistance) {
        minDistance = dist;
        bestIndex = i;
      }
    }

    const nextTask = unvisited.splice(bestIndex, 1)[0];
    sequence.push(nextTask);

    const nextCoords = {
      latitude: nextTask.sourceLatitude || startCoords.latitude,
      longitude: nextTask.sourceLongitude || startCoords.longitude
    };

    // Find detailed grid route between points
    const stepRoute = getRoute(currentCoords, nextCoords);
    totalDistance += stepRoute.totalDistance;
    routePoints.push(...stepRoute.coordinates.slice(1));

    currentCoords = nextCoords;
  }

  return {
    sequence,
    routePoints,
    totalDistance: parseFloat(totalDistance.toFixed(3))
  };
}
