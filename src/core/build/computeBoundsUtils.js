// computes the union of the bounds of all of the given primitives and puts the resulting box in "target".
// A bounding box is computed for the centroids of the primitives, as well, and placed in "centroidTarget".
// These are computed together to avoid redundant accesses to bounds array.
export function getBounds( primitiveBounds, offset, count, target, centroidTarget ) {

	let minx = Infinity;
	let miny = Infinity;
	let minz = Infinity;
	let maxx = - Infinity;
	let maxy = - Infinity;
	let maxz = - Infinity;

	let cminx = Infinity;
	let cminy = Infinity;
	let cminz = Infinity;
	let cmaxx = - Infinity;
	let cmaxy = - Infinity;
	let cmaxz = - Infinity;

	const boundsOffset = primitiveBounds.offset || 0;
	for ( let i = ( offset - boundsOffset ) * 6, end = ( offset + count - boundsOffset ) * 6; i < end; i += 6 ) {

		const cx = primitiveBounds[ i + 0 ];
		const hx = primitiveBounds[ i + 1 ];
		const lx = cx - hx;
		const rx = cx + hx;
		if ( lx < minx ) minx = lx;
		if ( rx > maxx ) maxx = rx;
		if ( cx < cminx ) cminx = cx;
		if ( cx > cmaxx ) cmaxx = cx;

		const cy = primitiveBounds[ i + 2 ];
		const hy = primitiveBounds[ i + 3 ];
		const ly = cy - hy;
		const ry = cy + hy;
		if ( ly < miny ) miny = ly;
		if ( ry > maxy ) maxy = ry;
		if ( cy < cminy ) cminy = cy;
		if ( cy > cmaxy ) cmaxy = cy;

		const cz = primitiveBounds[ i + 4 ];
		const hz = primitiveBounds[ i + 5 ];
		const lz = cz - hz;
		const rz = cz + hz;
		if ( lz < minz ) minz = lz;
		if ( rz > maxz ) maxz = rz;
		if ( cz < cminz ) cminz = cz;
		if ( cz > cmaxz ) cmaxz = cz;

	}

	target[ 0 ] = minx;
	target[ 1 ] = miny;
	target[ 2 ] = minz;

	target[ 3 ] = maxx;
	target[ 4 ] = maxy;
	target[ 5 ] = maxz;

	centroidTarget[ 0 ] = cminx;
	centroidTarget[ 1 ] = cminy;
	centroidTarget[ 2 ] = cminz;

	centroidTarget[ 3 ] = cmaxx;
	centroidTarget[ 4 ] = cmaxy;
	centroidTarget[ 5 ] = cmaxz;

}

// scratch storage reused across refit leaf computations so no per-leaf allocations occur.
const _centroidBounds = new Float32Array( 6 );

// Computes a refitted leaf's bounds using the same bounding-box convention as the build path:
// each primitive's bounds are expanded by the float32 machine epsilon (see "computePrimitiveBounds")
// and the leaf bounds are then taken as the union of those padded bounds. Recomputing a leaf from
// the bare vertex hull without this padding produces tighter boxes than the build path which, at
// float32 precision, can exclude a ray grazing a shared vertex and cause missed picks.
//
// The bvh's own "computePrimitiveBounds" performs the padding so every subclass keeps the exact
// center / epsilon arithmetic its build used; "getBounds" then unions the padded primitives with
// the same function the build uses to write a node's bounds.
export function computeRefitBounds( bvh, offset, count, target ) {

	// per-primitive padded bounds in the build path's center + half-extent format. Grown on demand
	// but cached on the function so repeated refit calls don't reallocate for the common leaf sizes.
	let paddedBounds = computeRefitBounds._paddedBounds;
	if ( paddedBounds === undefined || paddedBounds.length < count * 6 ) {

		paddedBounds = new Float32Array( count * 6 );
		computeRefitBounds._paddedBounds = paddedBounds;

	}
	paddedBounds.offset = offset;

	// delegate the epsilon padding to the same routine the build path runs, preserving whichever
	// formula the bvh subclass implements (see MeshBVH vs the base BVH implementation)
	bvh.computePrimitiveBounds( offset, count, paddedBounds );

	// take the union of the padded bounds with the same function used during the build
	return getBounds( paddedBounds, offset, count, target, _centroidBounds );

}
