"""Compatibility entry point: rebuild current v7 assets, never overwrite with v2 geometry."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))
import build_priority
import build_gates


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    asset = args[args.index('--asset') + 1] if '--asset' in args else 'all'
    if asset.startswith('gate_'):
        # Gate generation is inexpensive and always keeps the three entrances consistent.
        build_gates.main()
    else:
        build_priority.main()
        if asset == 'all':
            build_gates.main()
