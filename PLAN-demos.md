# Interactive Demonstrations — Build Plan

Scope: AP Biology Units 1–8 and AC Chemistry Units 1–8 (per the Strake Jesuit curriculum doc).

Method: every curriculum topic was surveyed for a candidate demo, then every proposal was put through an
adversarial pass that (a) actually fetched each external simulation URL to confirm it is real, free, and
still HTML5, and (b) hunted for places where a naively-built simulation would teach something false.

- 152 candidate demos evaluated across 16 units
- 51 external simulations proposed; **11 failed verification** (dead Java, wrong slug, or content mismatch)
- Recommendation: **44 custom builds, 34 verified external links, 38 topics deliberately left without a demo**

The live inventory is at [`resources/demos/`](resources/demos/index.html), filterable by course, unit, and
whether an item is built here or linked out.

---

## 1. Shape of the project

This is a two-to-three-year project at a working teacher's pace, not a summer. At the stated sizing
(8 small, 28 medium, 8 large): **roughly 200 hours for the full 44.** Plan accordingly — the queue below is
ordered so that stopping at any point still leaves a coherent set.

Three principles drove the cuts:

1. **A wrong simulation is worse than no simulation.** Section 7 lists ten specific places where the
   obvious implementation teaches the opposite of the truth. Those are build-time requirements, not notes.
2. **Don't rebuild PhET.** Where a maintained free sim already nails a concept, link it. Where the free
   ecosystem has a genuine hole — and it does, badly, for equilibrium — building creates value that
   cannot be obtained any other way.
3. **Don't replace a wet lab with a screen.** The Density, Titration, Dilution, Airbag, Cheeto, and Lab
   Reactions labs stay wet. Several builds below are explicitly positioned as their *pre-lab prediction*
   or *post-lab analysis*, which is additive rather than substitutive.

---

## 2. Infrastructure — build this first, once

Right now `resources/worldcup/index.html` re-declares the entire color palette inline. That is fine for one
page and untenable for thirty. Before the first demo:

- `assets/css/demo.css` — the palette, theme variables, control/slider/readout styling, plot axes,
  responsive grid. One stylesheet every demo links.
- `assets/js/demo-shell.js` — the theme bootstrap (currently duplicated in three files), the light/dark
  toggle, a back-link to the hub, and a shared canvas helper that handles devicePixelRatio and resize.
- `resources/demos/index.html` — a hub page filterable by course and unit. The Resources tab on the main
  site links to the hub, not to thirty cards.
- Each demo lives at `resources/demos/<slug>/index.html`, self-contained apart from the two shared assets.

Conventions to hold: vanilla JS, no framework, no build step, works on a phone, works in both themes.
Every demo gets a one-line "what this shows" header and a "the misconception this fixes" footer — the
demos are worth more if a student reads why they exist.

---

## 3. If you only build ten

Six fast wins to establish the shell, then the two flagships. This set alone covers the highest-frequency
misconceptions in both courses.

| # | Demo | Unit | Effort | Why this one |
|---|------|------|--------|--------------|
| 1 | **The pH Ruler** — four numbers, one slider | Chem 7 | S | Best value-per-hour in the entire plan. One log slider drives [H₃O⁺], [OH⁻], pH, pOH; type any one, the other three recompute. PhET's pH Scale is capped at real liquids and never mentions pOH. |
| 2 | **Where Did the Heat Go?** | Chem 6 | S | Kills "endothermic means it gets cold" by separating system from surroundings on screen. |
| 3 | **Build a Polymer** | Bio 1 | S | Students think water is *added* when a bond forms. Watch the counter: n monomers → n−1 bonds → n−1 waters. |
| 4 | **Heavy, Light, Hybrid** — run Meselson–Stahl | Bio 6 | S | Students recite "semiconservative" but can't say what conservative and dispersive would have *predicted*. Generation 2 is what settles it. |
| 5 | **Same Squares, Different Ratios** | Bio 5 | S | 9:7 and 12:3:1 aren't different Punnett squares — the genotype ratio is always 9:3:3:1, only the phenotype lumping changes. Add the sex-linkage toggle here (see §6). |
| 6 | **Ten Percent** | Bio 8 | S | Drag transfer efficiency 5%→20% and watch top-predator count move ~250-fold over four levels. Also fixes "10% is a law" and "pyramids are always upright." |
| 7 | **Unit Railroad** | Chem 1 | M | Live unit cancellation as you chain conversion factors. A worksheet structurally cannot do this — the whole skill is orienting the factor so the unwanted unit cancels *before* a calculator is involved. |
| 8 | **Dynamic Equilibrium** — a molecular coin flip | Chem 8 | M | Thousands of random conversion events; at the plateau the forward and reverse counters are visibly *equal and nonzero* while amounts sit at unequal values. **Nothing free exists for this anywhere** (see §5). |
| 9 | **Allele Machine** (Hardy–Weinberg + drift tabs) | Bio 7 | L | Your wheelhouse, and the flagship. 100+ replicate populations side by side: each trajectory unpredictable, the ensemble sharply predictable. Kills "dominant means common" and "drift means anything can happen." |
| 10 | **Stoichiometry Road Map** | Chem 4 | L | Load-bearing: it absorbs five otherwise-uncovered Unit 4 topics (molar mass, Avogadro, mole–gram, mixed mole problems, the steps themselves). If it ships thin, the most heavily assessed skill in first-year chemistry has a hole in it. |

---

## 4. Full build queue

Sequenced by **teaching calendar**, not unit number. This matters: Bio Units 7–8 carry more builds than
Chem Units 4–8 combined, and they're taught last — if the project runs short, sequencing by unit number
means the deficits land on content the class may not reach while September's material shipped long ago.

### Wave 1 — fall semester

**Chemistry**
- `Accurate, Precise, Both, Neither` (U1, S) — averaging shrinks random scatter as 1/√n but leaves
  systematic bias untouched. Good first build to shake out the shared shell.
- `Unit Railroad` (U1, M) — *top ten*
- `Read the Instrument` (U1, M) — sig figs by estimating the uncertain digit off a rendered graduated
  cylinder at variable zoom. A worksheet hands you the digits already written; this is the one drill
  where automation decisively wins.
- `Electronic Structure Bench` (U2, L) — **consolidate three proposals into one tabbed build**: orbital
  probability clouds, successive-ionization-energy jumps, and the periodic sawtooth. All three orbit the
  same idea, and tabs make the connection explicit instead of leaving students to notice it.
- `Electron Budget` (U3, L) — reframes Lewis structures as spending a fixed valence-electron budget
  rather than handing out octets and counting afterward.
- `Why Water Should Boil at Minus 80` (U3, M) — real boiling-point data by group; within an IMF class
  boiling point tracks molar mass, and then water breaks the trend by ~200 °C.
- `Stoichiometry Road Map` (U4, L) — *top ten*
- `Which One Runs Out? (grams lie)` (U4, M) — a case where the gram comparison and the mole-with-ratio
  comparison give *different* answers, side by side.

**Biology**
- `Build a Polymer` (U1, S) — *top ten*
- `Hydrogen Bond Bench` (U1, M) — **descoped**: capillary action (cohesion vs adhesion) and a
  within-sim energy-storage comparison only. Let the penny-and-dropper and paperclip demos carry surface
  tension. See §7 trap 1 before writing a line of this.
- `Fold It Yourself: a lattice protein` (U1, L) — fold a 2D HP chain and watch hydrophobic residues bury
  themselves; one substitution restructures the whole molecule. See §7 traps 6 and 10.
- `Why Cells Are Small` (U2, M) — see §7 trap 2; lead with the critical radius, not diffusion time.
- `Water Potential Bench` (U2, M) — see §7 trap 5; Ψp must include the hydrostatic head.
- `Enzyme Bench` (U3, M) — adding substrate fully rescues competitive inhibition and does nothing for
  noncompetitive. The free sim at biologysimulations.com covers temp/pH/concentration but **not**
  inhibition, which is exactly the part that's assessed.
- `Proton Gradient Bench` (U3, M) — the uncoupler diagnostic: electron flow speeds up, O₂ consumption
  rises, ATP goes to zero. See §7 trap 7.

### Wave 2 — spring semester

**Chemistry**
- `Gas Law Bench — plot it yourself` (U5, M) — one relation PV/T, not three unrelated laws; and why
  Celsius produces negative volumes.
- `Airbag Designer` (U5, M) — pre-lab for the Airbag Lab. Kills "22.4 L/mol is a universal constant."
- `Heating Curve — where the energy hides` (U6, M) — **add the synced particle panel**: during plateaus,
  average particle *speed* stays constant while spacing changes. This absorbs the states-of-matter topic
  whose external resource failed verification, at near-zero marginal cost.
- `Dissolving Bench` (U7, M) — **new, and non-optional.** The longest unit in the course currently opens
  with nothing because its only assigned resource (PhET Sugar and Salt Solutions) is dead Java. Particle
  beaker: NaCl dissociates into hydrated ions, sucrose disperses intact, nonpolar refuses, conductivity
  bulb as evidence. This is the conceptual prerequisite for every net-ionic equation later in the unit.
- `The pH Ruler` (U7, S) — *top ten*
- `Solubility Curves` (U7, M) — read it, cool it, crystallize it. See §7 trap 9.
- `Mix It` (U7, L) — load-bearing for the longest unit: molecular / complete ionic / net ionic equations,
  precipitation, predicting products, spectator ions. **Must include a self-checking drill on which
  combination precipitates** — students fail net-ionic problems on the solubility rules, not the algebra.
- `Titration Curve Lab` (U7, M) — solve by bisection on the full charge balance, not piecewise regions.
- `Dynamic Equilibrium + Two Rates, One Line` (U8, M) — *top ten*, merged with the gap-critic's addition:
  twin plots of forward/reverse *rate* converging while concentrations plateau at clearly *unequal*
  values, started from both pure reactants and pure products.
- `ICE Workbench` (U8, L) — sign of x from Q vs K, coefficients in the change row, and the "x is small"
  shortcut visibly breaking.
- `Ka and Percent Ionization` (U8, M) — dilute a weak acid and percent ionization goes *up* toward 100%
  while pH still rises. That result feels wrong to every student.

**Biology**
- `Amplifier` (U4, M) — why a cascade has four steps: each tier multiplies, ~10 hormone molecules →
  millions of product.
- `Gamete Machine` (U4, M) — allele-level meiosis I vs meiosis II nondisjunction. No existing resource
  shows this distinction; the Learn.Genetics karyotype link originally paired with it is dead Flash.
- `Same Squares, Different Ratios` (U5, S) — *top ten*
- `Does 3:1 Ever Look Like 3:1?` (U5, M) — sampling, chi-square, and why 28:12 isn't a failed experiment.
- `From Bins to Bell Curve` (U5, S) — drag locus count 1→8 and watch categories become a continuum.
- `Heavy, Light, Hybrid` (U6, S) — *top ten*
- `Break a Gene` (U6, M) — a random substitution is silent ~25% of the time and nonsense only a few
  percent; the code's redundancy is *structured* at the third position.
- `Operon Logic: predict the mutant` (U6, M) — lac as an AND gate, not a switch; predict lacI⁻ and Oᶜ.
  **Add a eukaryotic enhancer tab** (see §6) — the engine is already there.
- `Allele Machine` (U7, L) — *top ten*
- `Selection Shaper` (U7, L) — stabilizing selection cutting variance while the mean stays put.
- `Did the mutation come first?` (U7, M) — replica plating: resistant colonies at the same grid positions
  on independent plates. The single most stubborn misconception in the unit.
- `Speciation Sandbox` (U7, M) — **descoped from the dropped Divergence Sandbox.** Two populations, a
  barrier you raise and lower, one accumulating isolation number. The one interaction that matters:
  raise the barrier, wait, lower it — get re-fusion or hybrid inviability depending on elapsed time.
- `Logistic Growth` (U8, M) — populations overshoot K and oscillate; growth is fastest at K/2.
- `Survivorship: read the axis` (U8, M) — Type II is straight only because the y-axis is logarithmic.
- `Population Momentum` (U8, M) — fertility at replacement doesn't stop growth for 40–60 years.
- `Ten Percent` (U8, S) — *top ten*
- `The Carbon Bathtub` (U8, M) — stock-and-flow. **Add a "Runoff" mode** for eutrophication (see §6):
  same machinery, different reservoir labels.

---

## 5. Link, don't build — verified

All URLs below were fetched and confirmed live, free, and HTML5. PhET HTML5 sims are CC-BY and genuinely
iframe-embeddable; on a phone, linking out is still better than embedding, but for viewport reasons rather
than licensing.

**Chemistry**
- Density — `phet.colorado.edu/en/simulations/density`
- States of Matter: Basics — `phet.colorado.edu/en/simulations/states-of-matter-basics`
- Build an Atom — `phet.colorado.edu/en/simulations/build-an-atom`
- Models of the Hydrogen Atom — `phet.colorado.edu/en/simulations/models-of-the-hydrogen-atom`
  *(slug corrected — `hydrogen-atom` is wrong)*
- Molecule Shapes — `phet.colorado.edu/en/simulations/molecule-shapes`
- Molecule Polarity — `phet.colorado.edu/en/simulations/molecule-polarity` *(already in your Unit 3 doc)*
- Balancing Chemical Equations — `phet.colorado.edu/sims/html/balancing-chemical-equations/latest/balancing-chemical-equations_en.html`
- Gas Properties / Gases Intro — `phet.colorado.edu/sims/html/gas-properties/latest/gas-properties_en.html`
  *(already in your Unit 5 doc)*
- Molarity — `phet.colorado.edu/sims/html/molarity/latest/molarity_all.html`
- Concentration — `phet.colorado.edu/sims/html/concentration/latest/concentration_all.html`
- Acid-Base Solutions — `phet.colorado.edu/sims/html/acid-base-solutions/latest/acid-base-solutions_all.html`
  *(already in your Unit 7 doc)*
- pH Scale — `phet.colorado.edu/sims/html/ph-scale/latest/ph-scale_all.html`
- Intermolecular Attractions (Concord) — `learn.concord.org/resources/134/intermolecular-attractions`
- RSC Titration Screen Experiment — `edu.rsc.org/resources/titration-screen-experiment/2077.article`
  *(article ID corrected)*

**Biology**
- Learn.Genetics: Inside a Cell — `learn.genetics.utah.edu/content/cells/insideacell/`
- PhET Membrane Transport — `phet.colorado.edu/sims/html/membrane-transport/latest/membrane-transport_all.html`
- HHMI Photosynthesis / ATP Synthesis / Electron Transport Chain — `biointeractive.org/classroom-resources/photosynthesis`
- BioMan Respiration Interactive — `biomanbio.com/HTML5GamesandLabs/PhotoRespgames/respiration-interactive-page.html`
  *(ad-supported, not ad-light — set expectations)*
- HHMI Eukaryotic Cell Cycle and Cancer — `biointeractive.org/classroom-resources/eukaryotic-cell-cycle-and-cancer`
- Geniventure (Concord) — `concord-consortium.github.io/geniblocks/gv2/`
- DNALC 3D Mechanism of Replication — `dnalc.cshl.edu/resources/3d/04-mechanism-of-replication-advanced.html`
- PhET Gene Expression Essentials — `phet.colorado.edu/sims/html/gene-expression-essentials/latest/gene-expression-essentials_all.html`
- Learn.Genetics Transcribe and Translate — `learn.genetics.utah.edu/content/basics/txtl/`
- Learn.Genetics PCR Virtual Lab — `learn.genetics.utah.edu/content/labs/pcr/pcr_interactive/PCR%20Interactive.html`
  *(deep path — the `/labs/pcr/` landing page is now an expository reading page, not the lab)*
- HHMI CRISPR-Cas9 — `biointeractive.org/classroom-resources/crispr-cas9-mechanism-applications`
- HHMI Lizard Evolution Virtual Lab — `biointeractive.org/classroom-resources/lizard-evolution-virtual-lab`
- HHMI Creating Phylogenetic Trees from DNA Sequences — `biointeractive.org/classroom-resources/creating-phylogenetic-trees-dna-sequences`
- HHMI Exploring Transitional Fossils — `biointeractive.org/classroom-resources/exploring-transitional-fossils`
- HHMI Population Dynamics — `biointeractive.org/classroom-resources/population-dynamics`
- US Census International Data Base (age pyramids) — `census.gov/data-tools/demo/idb/`
- NASA Global Maps, rainfall + vegetation — `science.nasa.gov/earth/earth-observatory/global-maps/total-rainfall-vegetation/`
  *(Earth Observatory migrated to science.nasa.gov; the old `earthobservatory.nasa.gov/global-maps/...` path 301s to a generic page)*
- En-ROADS Climate Solutions — `en-roads.climateinteractive.org/`
- MolView — `molview.org` *(durability risk: the classic free app is in bug-fix-only maintenance while a
  new version adds premium features)*

### Links that failed verification — do not use

| Resource | Status |
|---|---|
| **PhET Sugar and Salt Solutions** | **Dead.** No HTML5 version exists; `..._all.html` 404s and only a CheerpJ Java loader remains. The landing page resolves and will fool a casual check. This was the assigned resource for *two* topics (Bio U1 water as solvent, Chem U7 dissolving) — hence the new Dissolving Bench. |
| **PhET Membrane Channels** | Deprecated Java predecessor. **Membrane Transport is the HTML5 rewrite** — never offer Membrane Channels as a fallback. |
| **PhET Gene Machine: Lac Operon** | Legacy Java under CheerpJ. Not viable on student phones. Build Operon Logic instead. |
| **PhET Reversible Reactions** | Legacy Java. This is *why* your Unit 8 doc lists no resource — see below. |
| **Learn.Genetics Gel Electrophoresis** | Flash `.swf` under the Ruffle emulator. May work on a laptop; caveat it. |
| **Learn.Genetics Make a Karyotype** | Flash under Ruffle. |
| **Concord Predator-Prey (resource 164)** | Requires a Java download; its own requirements block says so. Use NetLogo Web's Wolf-Sheep model, or build it. |
| **Concord Phase Change (resource 784)** | Resolves and is genuinely titled "Phase Change," but its control set is a single checkbox — not the simulation it appeared to be. |

**Worth stating plainly: every PhET sim already cited in your curriculum doc verified live** — Molecule
Polarity, Gas Properties, and Acid-Base Solutions are all current HTML5 and actively maintained.

---

## 6. Small additions that ride on builds already scheduled

Each of these was originally dropped, and each costs almost nothing because the engine already exists:

- **Sex-linked inheritance** → a sex-linkage toggle and a "swap parents" button on *Same Squares,
  Different Ratios*. The entire content of sex linkage is that *direction matters* — white-eyed male ×
  red-eyed female differs from the reciprocal — and two static side-by-side squares hide the asymmetry
  because both are already drawn for you. Perennial FRQ topic.
- **Eukaryotic gene regulation / enhancers** → a second tab on *Operon Logic*. Three enhancer sites ×
  which transcription factors a cell type happens to have = same gene on in liver, off in neuron. That's
  "same genome, different cells," and toggling inputs to flip an output is what interactives do best.
- **Eutrophication** → a "Runoff" mode in *The Carbon Bathtub*. Fertilizer → algal bloom → decomposer
  respiration → dissolved oxygen crash → fish kill, with a lag between stopping input and recovery.
- **States of matter changes** → the particle panel on *Heating Curve* (see Wave 2).

---

## 7. Scientific traps — build-time requirements

These are the highest-value output of the review. Each is a place where the obvious implementation teaches
something false. Treat them as acceptance criteria.

1. **Water's specific heat is a *per-gram* fact.** 4.18 J/g·K is driven substantially by water's tiny
   18 g/mol molar mass. *Per mole*, water (75.3 J/mol·K) is among the **lowest** of common liquids —
   benzene 136, hexane 196, ethanol 112. A particle simulation measures energy per particle, i.e. per
   mole, so mapping sim output to real units yields the **opposite** of the intended lesson. Keep the
   Hydrogen Bond Bench comparison strictly within-sim and dimensionless (fraction of injected energy
   stored in broken bonds vs. going into motion, same particles with H-bonding on vs. off). Never print
   J/g·K or °C for real water on that panel.

2. **"Cells are small because diffusion is slow" is the wrong mechanism.** With D ≈ 2000 µm²/s, a 10 µm
   cell equilibrates in about 8 milliseconds and even a 100 µm one in under a second — negligible against
   a cell cycle measured in hours. The real constraint is the steady-state Krogh
   criterion, R_crit = √(6·D·Cs/k). Lead with critical radius; demote r² timing to a secondary
   observation and be honest that the transient is fast. Also: the shape toggle needs per-geometry
   constants (sphere /6, cylinder /4, slab /2) — reusing the sphere formula for a flattened disc is a
   silent wrong answer.

3. **Limiting factors are a minimum, not a product.** A photosynthesis rate model built as
   light × CO₂ × temperature means raising CO₂ at low light still raises the rate proportionally —
   precisely the wrong answer AP asks for. Use min()/co-limitation (Blackman). Separately, CAM is
   *temporally* separated (night uptake), so a steady-state daytime slider model cannot represent it.

4. **Lipids are not polymers.** A triglyceride is glycerol + 3 fatty acids: 4 molecules, 3 ester bonds,
   3 waters — the "n monomers, n−1 bonds, n−1 waters" rule breaks. Special-case the lipid tab in Build a
   Polymer, cap it at 3, and say so on screen. (Footnote: phosphodiester bonds in vivo come from
   nucleoside triphosphates releasing pyrophosphate, not dehydration.)

5. **Water potential needs the hydrostatic head.** If Ψp comes only from a slider and ignores the pressure
   generated as one chamber physically fills, the sim teaches that unopposed osmosis runs to equal
   concentration. In a real U-tube it does not — the rising column's own pressure *is* Ψp, and that's the
   classic demo. (Verified correct in the spec: R = 0.0831 L·bar/mol·K, 1.0 M sucrose at 295 K →
   Ψs = −24.5 bar, matching the AP formula sheet.)

6. **2D lattice protein ground states are usually degenerate.** "Cool it and it refolds to the same core"
   would visibly contradict "primary structure determines tertiary" on the second run with a different
   seed. Presets must be hand-designed sequences with verified unique ground states, checked at build time.

7. **Proton-motive force is mostly ΔΨ, not ΔpH.** Real inner-membrane ΔpH is only ~0.75 units (~40–60 mV)
   while total pmf is ~180–220 mV, dominated by membrane potential. A [H⁺]-only model structurally cannot
   produce a realistic pmf and reinforces the common textbook error. Track ΔΨ and ΔpH separately;
   pmf = ΔΨ − 59·ΔpH. (The back-pressure term is load-bearing — it's what makes the oligomycin case come
   out right for free: pmf rises, electron flow slows.)

8. **Kw = 1.0×10⁻¹⁴ only at 25 °C.** The pH Ruler's headline claim that the product pins at 10⁻¹⁴ is true
   across concentration but not across temperature. Unqualified, it teaches that pH 7 is universally
   neutral — at 50 °C neutral water is pH ≈ 6.6 and still neutral. One label reading "25 °C" fixes it.

9. **A point above a solubility curve is ambiguous.** Those coordinates describe two physically different
   states: a saturated solution sitting on excess undissolved solid (what you actually get if you dump
   that much in), or a genuinely supersaturated metastable solution (reachable only by dissolving hot,
   then cooling gently). The demo must distinguish them by *path*, not position. Also use monotone
   interpolation (PCHIP) — a natural cubic spline through tabulated solubility data overshoots and draws
   false non-monotonic wiggles.

10. **Two demos currently contradict each other on denaturation.** Fold It Yourself refolds on cooling
    (reversible, Anfinsen); Enzyme Bench latches denaturation irreversibly. Both are defensible alone;
    together on one site a sharp student will catch it. Reconcile with a shared note: small single-domain
    proteins can refold, but in practice aggregation usually prevents it.

Also: **the 10% rule is a rough average, not a law**, and **Le Chatelier demos must never show a catalyst
shifting equilibrium position** — the two classic traps in their respective units.

---

## 8. Deliberately left without a demo

This is the part worth reading closely. 38 topics get no interactive, in four categories.

### 8a. Genuinely not demonstrable — nothing varies

There is no variable a student can move that reveals anything the sentence didn't already say.

- **Elements of life / CHNOPS** (Bio 1) — a membership list.
- **Amino acid R-group classification** (Bio 1) — a four-bin lookup table with fixed membership. An
  interactive version is a flashcard with extra steps. The one distinction AP asks students to *reason*
  with (hydrophobic buried, polar facing water) is already inside Fold It Yourself.
- **Electron dot structures for single atoms** (Chem 2) — a one-step read off the group number, and it
  must be automatic on paper. All the genuine difficulty lives in molecular Lewis structures → Electron Budget.
- **Molar mass, Avogadro's number, mole–gram conversions, mixed mole problems, percent composition**
  (Chem 4) — arithmetic with no hidden structure, and a standalone calculator does the student's thinking
  at exactly the moment they need to practice it. All fold into Stoichiometry Road Map as levels. (The
  *scale* of 6.02×10²³ is worth a video; the calculation is not worth a sim.)
- **Enthalpy as a standalone topic; specific heat vs molar heat** (Chem 6) — a bookkeeping definition and
  a unit conversion. Both are more instructive inside Where Did the Heat Go? and the Mixer, where you
  watch the substance ranking reorder as you toggle units.
- **Spectator ions** (Chem 7) — definitionally a consequence of writing the complete ionic equation.
  Cannot exist apart from Mix It.
- **Molarity from grams/moles/volume** (Chem 8) — a verbatim restatement of Unit 7 molarity. Not a gap, a duplicate.
- **Writing the equilibrium expression** (Chem 8) — notation. Five minutes at the board plus a worksheet.
- **Origin of life** (Bio 7) — the honest reason, and one worth telling students: there is no consensus
  mechanism and the timescale is unobservable, so any simulation would have to assert one hypothesis
  (RNA world, metabolism-first) as though it were settled. A polished sim here teaches false confidence.

### 8b. The wet lab already beats any screen version

In every case the lab is preserved and, where useful, a build is positioned around it rather than over it.

- **Density Lab, Measurement Lab, Lab Safety** (Chem 1), **Gas Tube Demonstration** (Chem 2),
  **VSEPR molding kits** (Chem 3), **Lab Reactions** (Chem 4), **Gas Law Demonstration and Airbag Lab**
  (Chem 5), **Cheeto Lab** (Chem 6), **Titration and Dilution Labs** (Chem 7) — all stay wet.
- The two best structural pairings: **Airbag Designer as the Airbag Lab's pre-lab**, and **the Mixer's
  heat-loss slider as the Cheeto Lab's post-lab** — students drag heat loss until the simulation matches
  what their group actually measured, which is a better lesson than the calorimetry itself.
- **The crushed can / marshmallow demos** (Chem 5) — the rhetorical force is that it's *real* and slightly
  startling. Animating it removes the only thing that makes it work.
- **Plasmids, restriction cloning, bacterial transformation** (Bio 6) — pGLO *is* the experience. Heat
  shock, plating, and seeing your own colonies glow under UV two days later. A screen version of
  pipetting teaches nothing.
- **Water properties** (Bio 1) — a capillary tube, a penny with a dropper, and a paperclip floating on
  water beat any screen version of surface tension outright. This is why Hydrogen Bond Bench is descoped
  rather than cut: it keeps the two mechanisms a screen does better and hands the rest to the physical demos.

### 8c. A diagram or video teaches it better

- **Carbohydrate, lipid, and nucleic acid structural detail** (Bio 1) — comparative anatomy: starch vs
  cellulose linkage geometry, saturated vs unsaturated kinks, 5'→3' antiparallel. A labeled side-by-side
  plus MolView for the 3D reality beats a widget.
- **Bulk transport — endocytosis, phagocytosis, exocytosis** (Bio 2) — a sequence of events with no
  manipulable variable. You cannot turn a knob and get a wrong answer about phagocytosis.
- **Active site, substrate specificity, induced fit** (Bio 3) — an animation of conformational change.
- **ATP yield accounting (30/32/36/38)** (Bio 3) — the entire content is *which assumptions you make*
  (shuttle type, proton stoichiometry). A toggle-the-shuttle calculator produces a number students then
  memorize, which inverts the lesson. Worked table with footnotes.
- **Multiple alleles / ABO** (Bio 5) — bookkeeping over a partial dominance hierarchy, not a relationship.
- **r/K selection** (Bio 8) — a two-ended spectrum that ecologists have largely replaced, and it's
  de-emphasized in the current CED.
- **Nitrogen and phosphorus cycles** (Bio 8) — box-and-arrow maps. (The dynamic part students are actually
  assessed on, eutrophication, is picked up by the Carbon Bathtub Runoff mode.)
- **Ecological succession** (Bio 8) — Mount St. Helens and glacier-retreat timelapse. The persuasive
  content is seeing real decades compressed, not manipulating a rate.
- **Particle diagrams** (Chem 5) — students must *draw* these; it's the assessed representation. Read them
  in PhET, draw them on paper.
- **Physical vs chemical change; classification of matter** (Chem 1) — real footage of burning, rusting,
  dissolving, melting beats abstraction, and the sorting is a card sort. *If there's spare capacity late,
  a 90-minute particle-diagram sorter is the lowest-risk item on the whole list.*

### 8d. One judgment call flagged for you

**Nomenclature** (Chem 3) is the highest-volume skill in its unit, 100% machine-checkable, and exactly the
profile where automated drill with typed error feedback wins. It was ranked low only because ChemQuiz.net
and similar already generate infinite naming items. **The condition: check those tools first.** Most drills
jump straight to naming and skip the step that actually breaks students — the up-front classification
decision (is this ionic, molecular, or an acid?), which determines which rules even apply. If none of them
drill that decision, build `Classify, Then Name` and promote it into Wave 1.

---

## 9. Two things worth knowing

**Your Unit 8 blank is a hole in the field, not in your planning.** The AC Chem curriculum doc lists no
common activity and no additional resource for Equilibrium. That is because the free simulation ecosystem
genuinely has nothing maintained: PhET's Reversible Reactions is legacy Java, and no modern PhET sim covers
Le Chatelier, Q vs K, or ICE tables. Unit 8 is therefore the single place in either course where building
creates value obtainable no other way — and it's also the only unit with **zero external fallbacks**, so if
the build queue slips it ends with literally nothing. That's the argument for pulling the three equilibrium
builds forward out of calendar order.

**Three builds carry far more curriculum than their size suggests**, and all three are the medium-difficulty
ones where a thin implementation is tempting: **Stoichiometry Road Map** (absorbs five Unit 4 topics),
**Mix It** (five Unit 7 topics), and **Hydrogen Bond Bench** (the sole item for the opening topic of AP
Biology). Give those three the time they need or descope them honestly — don't ship them thin.
