import { BYTES_PER_NODE, UINT32_PER_NODE } from '../Constants.js';
import { COUNT, IS_LEAF, LEFT_NODE, OFFSET, RIGHT_NODE } from '../utils/nodeBufferUtils.js';
import { computeRefitBounds } from '../build/computeBoundsUtils.js';

// scratch bounds that receive each leaf's recomputed bounds
const _leafBounds = new Float32Array( 6 );

export function refit/* @echo INDIRECT_STRING */( bvh, nodeIndices = null ) {

	if ( nodeIndices && Array.isArray( nodeIndices ) ) {

		nodeIndices = new Set( nodeIndices );

	}

	let buffer, uint32Array, uint16Array, float32Array;
	let byteOffset = 0;
	const roots = bvh._roots;
	for ( let i = 0, l = roots.length; i < l; i ++ ) {

		buffer = roots[ i ];
		uint32Array = new Uint32Array( buffer );
		uint16Array = new Uint16Array( buffer );
		float32Array = new Float32Array( buffer );

		_traverse( 0, byteOffset );
		byteOffset += buffer.byteLength;

	}

	function _traverse( nodeIndex32, byteOffset, force = false ) {

		const nodeIndex16 = nodeIndex32 * 2;
		if ( IS_LEAF( nodeIndex16, uint16Array ) ) {

			const offset = OFFSET( nodeIndex32, uint32Array );
			const count = COUNT( nodeIndex16, uint16Array );

			// compute the bounds the same way the build computes a node's bounds - per primitive padded
			// bounds, then their union - so a refitted leaf carries the build path's float32 epsilon
			// padding instead of the bare hull of its primitives
			computeRefitBounds( bvh, offset, count, _leafBounds );

			if (
				float32Array[ nodeIndex32 + 0 ] !== _leafBounds[ 0 ] ||
				float32Array[ nodeIndex32 + 1 ] !== _leafBounds[ 1 ] ||
				float32Array[ nodeIndex32 + 2 ] !== _leafBounds[ 2 ] ||

				float32Array[ nodeIndex32 + 3 ] !== _leafBounds[ 3 ] ||
				float32Array[ nodeIndex32 + 4 ] !== _leafBounds[ 4 ] ||
				float32Array[ nodeIndex32 + 5 ] !== _leafBounds[ 5 ]
			) {

				float32Array[ nodeIndex32 + 0 ] = _leafBounds[ 0 ];
				float32Array[ nodeIndex32 + 1 ] = _leafBounds[ 1 ];
				float32Array[ nodeIndex32 + 2 ] = _leafBounds[ 2 ];

				float32Array[ nodeIndex32 + 3 ] = _leafBounds[ 3 ];
				float32Array[ nodeIndex32 + 4 ] = _leafBounds[ 4 ];
				float32Array[ nodeIndex32 + 5 ] = _leafBounds[ 5 ];

				return true;

			} else {

				return false;

			}

		} else {

			const left = LEFT_NODE( nodeIndex32 );
			const right = RIGHT_NODE( nodeIndex32, uint32Array );

			// the identifying node indices provided by the shapecast function include offsets of all
			// root buffers to guarantee they're unique between roots so offset left and right indices here.
			let forceChildren = force;
			let includesLeft = false;
			let includesRight = false;

			if ( nodeIndices ) {

				// if we see that neither the left or right child are included in the set that need to be updated
				// then we assume that all children need to be updated.
				if ( ! forceChildren ) {

					const leftNodeId = left / UINT32_PER_NODE + byteOffset / BYTES_PER_NODE;
					const rightNodeId = right / UINT32_PER_NODE + byteOffset / BYTES_PER_NODE;
					includesLeft = nodeIndices.has( leftNodeId );
					includesRight = nodeIndices.has( rightNodeId );
					forceChildren = ! includesLeft && ! includesRight;

				}

			} else {

				includesLeft = true;
				includesRight = true;

			}

			const traverseLeft = forceChildren || includesLeft;
			const traverseRight = forceChildren || includesRight;

			let leftChange = false;
			if ( traverseLeft ) {

				leftChange = _traverse( left, byteOffset, forceChildren );

			}

			let rightChange = false;
			if ( traverseRight ) {

				rightChange = _traverse( right, byteOffset, forceChildren );

			}

			const didChange = leftChange || rightChange;
			if ( didChange ) {

				for ( let i = 0; i < 3; i ++ ) {

					const left_i = left + i;
					const right_i = right + i;
					const minLeftValue = float32Array[ left_i ];
					const maxLeftValue = float32Array[ left_i + 3 ];
					const minRightValue = float32Array[ right_i ];
					const maxRightValue = float32Array[ right_i + 3 ];

					float32Array[ nodeIndex32 + i ] = minLeftValue < minRightValue ? minLeftValue : minRightValue;
					float32Array[ nodeIndex32 + i + 3 ] = maxLeftValue > maxRightValue ? maxLeftValue : maxRightValue;

				}

			}

			return didChange;

		}

	}

}
