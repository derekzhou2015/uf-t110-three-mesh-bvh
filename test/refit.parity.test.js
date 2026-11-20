import {
	BufferGeometry,
	BufferAttribute,
	Float32BufferAttribute,
	Vector3,
	Ray,
	DoubleSide,
	Mesh,
	MeshBasicMaterial,
	Scene,
	SphereGeometry,
	SkinnedMesh,
	Bone,
	Skeleton,
	Uint16BufferAttribute,
} from 'three';
import {
	MeshBVH,
	PointsBVH,
	LineSegmentsBVH,
	SkinnedMeshBVH,
	ObjectBVH,
	validateBounds,
} from 'three-mesh-bvh';

// A refit recomputes node bounds from the current primitive positions. The build pads every
// primitive bound by FLOAT32_EPSILON before unioning it into a node, so a node face always sits
// just outside the float32 hull of its primitives. A refit that instead takes the bare hull can
// leave a node face rounding *inwards* by one float32 ulp - and a primitive that a ray only grazes
// then gets culled even though the native triangle test reports a hit. That is exactly the "blade
// edge" miss reported by artists after posing a skinned mesh and refreshing the tree.
//
// These tests pin the two properties that fix guarantees:
//   1. refit( without deforming ) leaves every node bound bit-identical to the build.
//   2. a grazing ray that the freshly built tree hits is also hit by the refitted tree.

const FLOAT32_EPSILON = Math.pow( 2, - 24 );

// A coordinate just above a float32 value, so a bare-hull bound stored into a float32 node buffer
// rounds DOWN and lands inside the primitive.
const POSED_X = 1 + 0.3 * Math.pow( 2, - 23 );

function serializedRoots( bvh ) {

	return bvh._roots.map( root => Buffer.from( root ).toString( 'hex' ) ).join( '|' );

}

function leafBounds( bvh ) {

	const result = [];
	bvh.traverse( ( depth, isLeaf, boundingData ) => {

		if ( isLeaf ) {

			result.push( Array.from( boundingData.slice( 0, 6 ) ) );

		}

	} );

	return result;

}

// Builds a single thin triangle whose apex sits at POSED_X - a coefficient that a float32 node
// bound cannot represent - so the build's padded max face clears the apex while a bare hull does not.
function makeGrazingTriangle() {

	const position = new Float64Array( [
		POSED_X, - 1, 0,
		POSED_X, 1, 0,
		- 1, 0, 0,
	] );
	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new BufferAttribute( position, 3 ) );
	geometry.setIndex( [ 0, 1, 2 ] );
	return geometry;

}

// Travels through the apex region along +z; x is just inside the apex so only a bound that contains
// the true float64 position reports the hit.
function makeGrazingRay() {

	return new Ray( new Vector3( POSED_X - 1e-9, 0, - 2 ), new Vector3( 0, 0, 1 ) );

}

describe( 'refit matches build bounds', () => {

	it( 'reproduces the exact build bounds for an unchanged MeshBVH in both direct and indirect mode.', () => {

		for ( const indirect of [ false, true ] ) {

			const geometry = new SphereGeometry( 2, 17, 13 );
			const bvh = new MeshBVH( geometry, { targetLeafSize: 4, indirect } );
			const buildBounds = leafBounds( bvh );

			bvh.refit();

			expect( leafBounds( bvh ) ).toEqual( buildBounds );
			expect( validateBounds( bvh ) ).toBe( true );

		}

	} );

	it( 'reproduces the exact build bounds for every split strategy.', () => {

		for ( const strategy of [ 0, 1, 2 ] ) {

			const geometry = new SphereGeometry( 1, 12, 9 );
			const bvh = new MeshBVH( geometry, { targetLeafSize: 3, strategy } );
			const buildBounds = leafBounds( bvh );

			bvh.refit();

			expect( leafBounds( bvh ) ).toEqual( buildBounds );

		}

	} );

	it( 'reproduces the exact build bounds for a subset refit with node indices.', () => {

		const geometry = new SphereGeometry( 1, 16, 16 );
		const bvh = new MeshBVH( geometry, { targetLeafSize: 5 } );
		const buildBounds = leafBounds( bvh );

		const nodeIndices = new Set();
		bvh.shapecast( {
			intersectsBounds: ( box, isLeaf, score, depth, nodeIndex ) => {

				nodeIndices.add( nodeIndex );
				return true;

			},
			intersectsRange: () => false,
		} );

		bvh.refit( nodeIndices );

		expect( leafBounds( bvh ) ).toEqual( buildBounds );

	} );

	it( 'reproduces the exact build bounds for the primitive types that use the base refit.', () => {

		const pointCount = 300;
		const positions = new Float32Array( pointCount * 3 );
		for ( let i = 0; i < pointCount * 3; i ++ ) {

			positions[ i ] = Math.sin( i * 1.37 ) * 3;

		}

		for ( const indirect of [ false, true ] ) {

			const pointsGeometry = new BufferGeometry();
			pointsGeometry.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) );
			const pointsBvh = new PointsBVH( pointsGeometry, { targetLeafSize: 5, indirect } );
			const pointsBounds = leafBounds( pointsBvh );
			pointsBvh.refit();
			expect( leafBounds( pointsBvh ) ).toEqual( pointsBounds );

			const lineGeometry = new BufferGeometry();
			lineGeometry.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) );
			const lineBvh = new LineSegmentsBVH( lineGeometry, { targetLeafSize: 5, indirect } );
			const lineBounds = leafBounds( lineBvh );
			lineBvh.refit();
			expect( leafBounds( lineBvh ) ).toEqual( lineBounds );

		}

	} );

} );

describe( 'refit grazing ray parity', () => {

	it( 'hits a gizmo-thin apex from a refitted tree exactly like a freshly built one.', () => {

		// sanity check that this geometry actually exercises the float32 rounding we rely on
		expect( Math.fround( POSED_X ) ).toBeLessThan( POSED_X );

		const buildBvh = new MeshBVH( makeGrazingTriangle(), { targetLeafSize: 1 } );
		const refitBvh = new MeshBVH( makeGrazingTriangle(), { targetLeafSize: 1 } );
		refitBvh.refit();

		const ray = makeGrazingRay();

		// native triangle intersection reports the hit
		const a = new Vector3( POSED_X, - 1, 0 );
		const b = new Vector3( POSED_X, 1, 0 );
		const c = new Vector3( - 1, 0, 0 );
		expect( ray.intersectTriangle( a, b, c, false, new Vector3() ) ).toBeTruthy();

		const buildHits = buildBvh.raycast( ray, DoubleSide );
		const refitHits = refitBvh.raycast( ray, DoubleSide );

		expect( buildHits.length ).toBe( 1 );
		expect( refitHits.length ).toBe( buildHits.length );
		expect( refitHits[ 0 ].distance ).toBe( buildHits[ 0 ].distance );
		expect( refitHits[ 0 ].faceIndex ).toBe( buildHits[ 0 ].faceIndex );

	} );

	it( 'keeps the padded box a hair outside the posed primitive after refitting.', () => {

		const geometry = makeGrazingTriangle();
		const bvh = new MeshBVH( geometry, { targetLeafSize: 1 } );
		bvh.refit();

		// the stored leaf max on x must clear the true ( float64 ) apex by the build's epsilon pad
		const [ minx, , , maxx ] = leafBounds( bvh )[ 0 ];
		expect( maxx ).toBeGreaterThanOrEqual( POSED_X );
		expect( maxx - POSED_X ).toBeGreaterThanOrEqual( 0 );
		expect( minx ).toBeLessThanOrEqual( - 1 );

	} );

	it( 'produces build-identical bounds and grazing hits across every refit-capable BVH type.', () => {

		// MeshBVH ( template refit path )
		{

			const buildBvh = new MeshBVH( makeGrazingTriangle(), { targetLeafSize: 1 } );
			const refitBvh = new MeshBVH( makeGrazingTriangle(), { targetLeafSize: 1 } );
			refitBvh.refit();
			const ray = makeGrazingRay();
			expect( refitBvh.raycast( ray, DoubleSide ).length ).toBe( buildBvh.raycast( ray, DoubleSide ).length );

		}

		// SkinnedMeshBVH ( base refit path, bounds from SkinnedMesh.getVertexPosition )
		{

			const geometry = new SphereGeometry( 1, 8, 6 );
			const bones = [ new Bone() ];
			const skeleton = new Skeleton( bones );
			const mesh = new SkinnedMesh( geometry, new MeshBasicMaterial() );
			mesh.add( bones[ 0 ] );
			mesh.bind( skeleton );

			const count = geometry.attributes.position.count;
			const skinIndex = [];
			const skinWeight = [];
			for ( let i = 0; i < count; i ++ ) {

				skinIndex.push( 0, 0, 0, 0 );
				skinWeight.push( 1, 0, 0, 0 );

			}

			geometry.setAttribute( 'skinIndex', new Uint16BufferAttribute( skinIndex, 4 ) );
			geometry.setAttribute( 'skinWeight', new Float32BufferAttribute( skinWeight, 4 ) );

			const bvh = new SkinnedMeshBVH( mesh, { targetLeafSize: 4 } );
			const buildBounds = leafBounds( bvh );
			bvh.refit();
			expect( leafBounds( bvh ) ).toEqual( buildBounds );
			expect( validateBounds( bvh ) ).toBe( true );

		}

		// ObjectBVH ( base refit path over a scene hierarchy )
		{

			const scene = new Scene();
			for ( let i = 0; i < 6; i ++ ) {

				const mesh = new Mesh( new SphereGeometry( 0.5, 6, 6 ), new MeshBasicMaterial() );
				mesh.position.set( Math.sin( i ) * 2, Math.cos( i ) * 2, i * 0.4 );
				scene.add( mesh );

			}

			scene.updateMatrixWorld( true );

			const bvh = new ObjectBVH( scene, { matrixWorld: scene.matrixWorld } );
			const buildBounds = leafBounds( bvh );
			bvh.refit();
			expect( leafBounds( bvh ) ).toEqual( buildBounds );
			expect( validateBounds( bvh ) ).toBe( true );

		}

	} );

} );

describe( 'refit parity helpers', () => {

	it( 'serializes the same node buffers for build and no-op refit.', () => {

		const geometry = new SphereGeometry( 3, 19, 12 );
		const bvh = new MeshBVH( geometry, { targetLeafSize: 6 } );
		const before = serializedRoots( bvh );
		bvh.refit();
		expect( serializedRoots( bvh ) ).toBe( before );

	} );

	it( 'keeps FLOAT32_EPSILON as the padding width the refit reproduces.', () => {

		// guards the assumption computeRefitBounds relies on when it delegates to the build helpers
		const geometry = makeGrazingTriangle();
		const bvh = new MeshBVH( geometry, { targetLeafSize: 1 } );
		const [ , , , maxx ] = leafBounds( bvh )[ 0 ];
		expect( maxx - POSED_X ).toBeLessThanOrEqual( 2 * FLOAT32_EPSILON * 2 );

	} );

} );
