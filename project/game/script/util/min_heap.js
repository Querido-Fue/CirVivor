/** In-place binary min-heap operations. The caller owns the array and ordering. */
export function pushMinHeap(heap, entry, compare) {
    let index = heap.length;
    heap.push(entry);
    while (index > 0) {
        const parentIndex = (index - 1) >> 1;
        const parent = heap[parentIndex];
        if (compare(parent, entry) <= 0) {
            break;
        }
        heap[index] = parent;
        index = parentIndex;
    }
    heap[index] = entry;
}

export function popMinHeap(heap, compare) {
    if (heap.length === 0) return null;
    const root = heap[0];
    const tail = heap.pop();
    if (heap.length === 0) return root;
    let index = 0;
    const halfLength = heap.length >> 1;
    while (index < halfLength) {
        let childIndex = (index << 1) + 1;
        let child = heap[childIndex];
        const rightIndex = childIndex + 1;
        if (rightIndex < heap.length
            && compare(heap[rightIndex], child) < 0) {
            childIndex = rightIndex;
            child = heap[rightIndex];
        }
        if (compare(tail, child) <= 0) {
            break;
        }
        heap[index] = child;
        index = childIndex;
    }
    heap[index] = tail;
    return root;
}
