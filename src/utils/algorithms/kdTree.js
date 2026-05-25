/**
 * 2D KD-Tree (K=2, dimensions = latitude & longitude)
 * Organizes geographic coordinates in a balanced tree to allow nearest-neighbor query in O(log N) average time.
 * Perfect for finding the nearest online collector to a pickup task.
 */
class KDNode {
  constructor(point, axis, left = null, right = null) {
    this.point = point; // { id, latitude, longitude, ... }
    this.axis = axis; // 0 for latitude, 1 for longitude
    this.left = left;
    this.right = right;
  }
}

export class KDTree {
  /**
   * @param {Object[]} points - Array of points, each containing latitude and longitude.
   */
  constructor(points) {
    this.root = this.build(points, 0);
  }

  /**
   * Recursively build a balanced KD-Tree
   */
  build(points, depth) {
    if (!points || points.length === 0) return null;

    const axis = depth % 2; // Alternates between 0 (Lat) and 1 (Lng)

    // Sort points by active axis
    points.sort((a, b) => {
      const valA = axis === 0 ? a.latitude : a.longitude;
      const valB = axis === 0 ? b.latitude : b.longitude;
      return valA - valB;
    });

    const medianIndex = Math.floor(points.length / 2);
    const medianPoint = points[medianIndex];

    const leftPoints = points.slice(0, medianIndex);
    const rightPoints = points.slice(medianIndex + 1);

    return new KDNode(
      medianPoint,
      axis,
      this.build(leftPoints, depth + 1),
      this.build(rightPoints, depth + 1)
    );
  }

  /**
   * Find the point closest to the target coordinates
   * @param {Object} targetCoords - { latitude, longitude }
   * @returns {Object|null} Closest point from the tree dataset
   */
  nearest(targetCoords) {
    if (!this.root) return null;
    const result = this._nearestSearch(this.root, targetCoords, null, Infinity);
    return result.bestNode;
  }

  _nearestSearch(node, target, bestNode, bestDist) {
    if (!node) return { bestNode, bestDist };

    const dist = this._euclideanDistance(node.point, target);
    let currentBestNode = bestNode;
    let currentBestDist = bestDist;

    if (dist < bestDist) {
      currentBestNode = node.point;
      currentBestDist = dist;
    }

    const axis = node.axis;
    const targetVal = axis === 0 ? target.latitude : target.longitude;
    const nodeVal = axis === 0 ? node.point.latitude : node.point.longitude;

    let nextNode = targetVal < nodeVal ? node.left : node.right;
    let otherNode = targetVal < nodeVal ? node.right : node.left;

    // Search the subtree that is on the same side of the partition plane
    const firstResult = this._nearestSearch(nextNode, target, currentBestNode, currentBestDist);
    currentBestNode = firstResult.bestNode;
    currentBestDist = firstResult.bestDist;

    // Check if the other subtree could possibly contain a closer point
    // Target distance to splitting plane:
    const planeDist = Math.abs(targetVal - nodeVal);
    if (planeDist < currentBestDist) {
      const secondResult = this._nearestSearch(otherNode, target, currentBestNode, currentBestDist);
      currentBestNode = secondResult.bestNode;
      currentBestDist = secondResult.bestDist;
    }

    return { bestNode: currentBestNode, bestDist: currentBestDist };
  }

  /**
   * Simple flat-earth Euclidean distance in coordinate degree units (fast for pruning checks)
   */
  _euclideanDistance(p1, p2) {
    const dLat = p1.latitude - p2.latitude;
    const dLng = p1.longitude - p2.longitude;
    return Math.sqrt(dLat * dLat + dLng * dLng);
  }
}

/**
 * Calculates real-world Haversine distance in kilometers
 * @param {Object} p1 - { latitude, longitude }
 * @param {Object} p2 - { latitude, longitude }
 * @returns {number} Distance in kilometers
 */
export function getHaversineDistance(p1, p2) {
  const R = 6371; // Earth's radius in km
  const dLat = ((p2.latitude - p1.latitude) * Math.PI) / 180;
  const dLng = ((p2.longitude - p1.longitude) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((p1.latitude * Math.PI) / 180) *
      Math.cos((p2.latitude * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
