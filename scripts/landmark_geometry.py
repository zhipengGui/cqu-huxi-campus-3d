"""Shared metre-space geometry; no Blender dependency."""
import math


def clean_ring(ring):
    out = []
    for x, y in ring:
        p = (float(x), float(y))
        if not out or math.dist(p, out[-1]) > 1e-5:
            out.append(p)
    if len(out) > 1 and math.dist(out[0], out[-1]) < 1e-5:
        out.pop()
    return out


def signed_area(ring):
    return sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring, ring[1:]+ring[:1]))/2


def inset_ring(ring, width):
    ring=clean_ring(ring);sign=1 if signed_area(ring)>0 else -1;out=[]
    for i,p in enumerate(ring):
        a,b=ring[i-1],ring[(i+1)%len(ring)]
        d1=math.dist(a,p);d2=math.dist(p,b)
        n1=(-(p[1]-a[1])/d1*sign,(p[0]-a[0])/d1*sign)
        n2=(-(b[1]-p[1])/d2*sign,(b[0]-p[0])/d2*sign)
        nx,ny=n1[0]+n2[0],n1[1]+n2[1];denom=max(.2,nx*n2[0]+ny*n2[1])
        scale=min(width/denom,3*width/max(math.hypot(nx,ny),.001))
        out.append((p[0]+nx*scale,p[1]+ny*scale))
    return out


def in_ring(p, ring):
    x, y = p
    hit = False
    for a,b in zip(ring, ring[1:]+ring[:1]):
        if (a[1]>y) != (b[1]>y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
            hit = not hit
    return hit


def contains(p, outer, holes=()):
    return in_ring(p, outer) and not any(in_ring(p,h) for h in holes)


def local_rings(outer, holes=()):
    outer = clean_ring(outer)
    cx=(min(p[0] for p in outer)+max(p[0] for p in outer))/2
    cy=(min(p[1] for p in outer)+max(p[1] for p in outer))/2
    rings=[]
    for i,r in enumerate([outer]+[clean_ring(h) for h in holes]):
        if (signed_area(r)>0) != (i==0):
            r=list(reversed(r))
        rings.append([(x-cx,y-cy) for x,y in r])
    return (cx,cy),rings
