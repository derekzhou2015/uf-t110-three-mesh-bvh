// scratch buffer receiving the padded per-primitive bounds of the leaf currently being refit. It is
// grown as needed and reused between leaves so refitting does not allocate per node.
let _refitPrimitiveBounds = /* @__PURE__ */ new Float32Array( 0 );

// scratch for the centroid bounds "getBounds" also computes but that a refit does not use
const _refitCentroidBounds = /* @__PURE__ */ new Float32Array( 6 );

// Computes the bounds a leaf covering "count" primitives starting at "offset" would have been given
// by the build, and writes them to "target" in min / max format.
//
// A node built by "buildTree" is the union of the *padded* per-primitive bounds returned by
// "computePrimitiveBounds" - each primitive bound is grown by FLOAT32_EPSILON before the union so a
// node face sits just outside the float32 hull of its primitives. Taking the bare hull of the
// primitives here, as a naive refit does, can leave a node face rounding inwards by one float32 ulp
// and cull primitives that merely graze it. Running the same padded-bounds + union the build uses
// makes a refitted node bit-identical to a freshly built one.
export function computeRefitBounds( bvh, offset, count, target ) {

	const length = count * 6;
	if ( _refitPrimitiveBounds.length < length ) {

		_refitPrimitiveBounds = new Float32Array( length );

	}

	// "computePrimitiveBounds" writes into "( i - offset ) * 6" and the union reads the same slice,
	// so the buffer must carry the leaf's absolute offset.
	const primitiveBounds = _refitPrimitiveBounds;
	primitiveBounds.offset = offset;
	bvh.computePrimitiveBounds( offset, count, primitiveBounds );
	getBounds( primitiveBounds, offset, count, target, _refitCentroidBounds );
	return target;

}

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
