import {
	BufferGeometry,
	BufferAttribute,
	Mesh,
	MeshBasicMaterial,
	DoubleSide,
	Raycaster,
	Vector3,
} from 'three';
import {
	MeshBVH,
	acceleratedRaycast,
	computeBoundsTree,
	disposeBoundsTree,
	validateBounds,
} from 'three-mesh-bvh';
import { intersectsNodeBounds } from '../../src/core/utils/intersectUtils.js';
import { runTestMatrix } from '../utils.js';

Mesh.prototype.raycast = acceleratedRaycast;
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

// Coordinates far enough from the origin that float32 rounding at a shared vertex is observable.
// At this scale the build path's FLOAT32_EPSILON leaf padding is what keeps a grazing ray inside
// the leaf box; an unpadded refit would tighten the box just past the ray.
const SCALE = 1e3;

// Two triangles meeting at the shared edge from (0,0,0) to (SCALE,0,0) in the z = 0 plane.
function createSharedEdgeGeometry() {

	const positions = new Float32Array( [
		// triangle above the edge
		0, 0, 0,
		SCALE, 0, 0,
		SCALE, SCALE, 0,
		// triangle below the edge, shares the two edge vertices
		0, 0, 0,
		0, - SCALE, 0,
		SCALE, 0, 0,
	] );
	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new BufferAttribute( positions, 3 ) );
	return geometry;

}

// small deterministic in-place deformation so refit has real work to do while keeping the
// shared-edge topology intact
function deform( geometry ) {

	const position = geometry.attributes.position;
	for ( let i = 0; i < position.count; i ++ ) {

		position.setXYZ(
			i,
			position.getX( i ) * 1.0000001 + ( i % 3 ) * 1e-4,
			position.getY( i ) * 1.0000001 + ( ( i + 1 ) % 3 ) * 1e-4,
			position.getZ( i ),
		);

	}

	position.needsUpdate = true;

}

function collectLeafBounds( bvh ) {

	const leaves = [];
	bvh.traverse( ( depth, isLeaf, boundingData, offset, count ) => {

		if ( isLeaf ) leaves.push( { bounds: Array.from( boundingData ), offset, count } );

	} );
	return leaves;

}

// A deterministic ray that natively intersects the triangles at their shared origin vertex but
// only stays inside the epsilon-padded leaf box. Against the bare (unpadded) hull that the old
// refit produced the node slab test rejects it, so traversal never reaches the triangles even
// though native triangle picking reports both as hits.
const GRAZING_ORIGIN = new Vector3( - 3.0194711904365964e-8, - 3.0194711904365964e-8, 0.0011613350732448448 );
const GRAZING_DIRECTION = new Vector3( 0.000025999999982424, 0.000025999999982424, - 0.9999999993240001 );

runTestMatrix( {
	indirect: [ false, true ],
	targetLeafSize: [ 1, 4 ],
}, ( desc, options ) => {

	describe( `refit grazing ray parity { ${ desc } }`, () => {

		it( 'refit reproduces the build leaf bounds when nothing moved', () => {

			const geometry = createSharedEdgeGeometry();
			const bvh = new MeshBVH( geometry, options );

			const builtLeaves = collectLeafBounds( bvh );
			bvh.refit();
			const refitLeaves = collectLeafBounds( bvh );

			// the refit path must apply the build's float32 epsilon padding, so with unchanged
			// vertices every leaf box comes back bit-for-bit identical. The old refit wrote the
			// bare vertex hull here and failed this comparison.
			expect( refitLeaves ).toEqual( builtLeaves );

		} );

		it( 'keeps every refitted leaf as permissive as the build convention after deformation', () => {

			const geometry = createSharedEdgeGeometry();
			const bvh = new MeshBVH( geometry, options );

			deform( geometry );
			bvh.refit();

			expect( validateBounds( bvh ) ).toBe( true );

			// each refitted leaf must still contain its epsilon-padded primitive hull. Recompute
			// that hull through the public build-path primitive bounds routine and assert
			// containment, allowing for the final float32 rounding into the node buffer.
			for ( const leaf of collectLeafBounds( bvh ) ) {

				const primitiveBounds = new Float32Array( leaf.count * 6 );
				primitiveBounds.offset = leaf.offset;
				bvh.computePrimitiveBounds( leaf.offset, leaf.count, primitiveBounds );

				for ( let i = 0; i < leaf.count; i ++ ) {

					for ( let axis = 0; axis < 3; axis ++ ) {

						const center = primitiveBounds[ i * 6 + axis * 2 ];
						const half = primitiveBounds[ i * 6 + axis * 2 + 1 ];

						// one float32 ulp of slack at this coordinate magnitude
						const tolerance = Math.abs( center ) * 2 ** - 23;
						expect( leaf.bounds[ axis ] ).toBeLessThanOrEqual( center - half + tolerance );
						expect( leaf.bounds[ axis + 3 ] ).toBeGreaterThanOrEqual( center + half - tolerance );

					}

				}

			}

		} );

		it( 'matches native raycasting for shallow rays after refit', () => {

			const geometry = createSharedEdgeGeometry();
			const mesh = new Mesh( geometry, new MeshBasicMaterial( { side: DoubleSide } ) );
			const bvh = new MeshBVH( geometry, options );

			deform( geometry );
			bvh.refit();

			// deterministic rays that strike right next to the shared edge / vertices
			const rays = [
				{ origin: new Vector3( SCALE * 0.25, SCALE * 0.25, 1e-3 ), target: new Vector3( SCALE * 0.25, 0, 0 ) },
				{ origin: new Vector3( SCALE * 0.75, - SCALE * 0.25, 1e-3 ), target: new Vector3( SCALE * 0.75, 0, 0 ) },
			];

			for ( const { origin, target } of rays ) {

				const direction = target.clone().sub( origin ).normalize();
				const raycaster = new Raycaster( origin, direction, 0, Infinity );

				const acceleratedHits = raycaster.intersectObject( mesh, false );

				geometry.boundsTree = null;
				const nativeHits = raycaster.intersectObject( mesh, false );
				geometry.boundsTree = bvh;

				expect( nativeHits.length ).toBeGreaterThan( 0 );
				expect( acceleratedHits.length ).toBe( nativeHits.length );
				expect( acceleratedHits.map( hit => hit.faceIndex ) )
					.toEqual( nativeHits.map( hit => hit.faceIndex ) );

			}

		} );

		it( 'does not cull a grazing ray that native picking hits at the shared vertex', () => {

			const geometry = createSharedEdgeGeometry();
			const mesh = new Mesh( geometry, new MeshBasicMaterial( { side: DoubleSide } ) );
			const bvh = new MeshBVH( geometry, options );
			geometry.boundsTree = bvh;

			const raycaster = new Raycaster( GRAZING_ORIGIN, GRAZING_DIRECTION, 0, Infinity );

			// native triangle picking hits both triangles at the shared origin vertex
			geometry.boundsTree = null;
			const nativeHits = raycaster.intersectObject( mesh, false );
			expect( nativeHits.length ).toBeGreaterThan( 0 );

			// the refitted (padded) tree must keep the same results
			geometry.boundsTree = bvh;
			bvh.refit();
			const acceleratedHits = raycaster.intersectObject( mesh, false );
			expect( acceleratedHits.length ).toBe( nativeHits.length );

			// node-level root-cause check. Build a synthetic node holding the bare (unpadded) hull
			// that the old refit wrote and one holding a build-convention padded leaf box, then run
			// the exact slab test traversal uses. The grazing ray must be rejected by the bare box
			// but accepted by the padded box - otherwise the leaf would have been culled before the
			// triangles could ever be tested, which is precisely the missed-pick path.
			const bareBox = new Float32Array( [ 0, 0, 0, SCALE, SCALE, 0 ] );
			const paddedBox = new Float32Array( [
				- 0.000030517578125,
				- 0.000030517578125,
				0,
				SCALE,
				SCALE,
				0,
			] );

			// intersectsNodeBounds reads the six bounds floats from the start of a node buffer
			const bareNode = new ArrayBuffer( 32 );
			new Float32Array( bareNode ).set( bareBox, 0 );
			const paddedNode = new ArrayBuffer( 32 );
			new Float32Array( paddedNode ).set( paddedBox, 0 );

			const ray = raycaster.ray;
			expect( intersectsNodeBounds( 0, new Float32Array( bareNode ), ray, 0, Infinity ) ).toBe( false );
			expect( intersectsNodeBounds( 0, new Float32Array( paddedNode ), ray, 0, Infinity ) ).toBe( true );

		} );

	} );

} );
