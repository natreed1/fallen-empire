# Why we use evolutionary optimization

We use **one** method: a population-based evolutionary algorithm with **multiple games per evaluation** to reduce noise. Here’s the research that supports this choice.

## Setting

- **Black-box fitness**: we only get a score (win/loss, margin) from running the game; no gradients.
- **Noisy**: same params can win or lose depending on map and combat RNG.
- **Many evaluations**: we can run thousands of short simulations quickly.
- **Goal**: find AI parameters (e.g. siege chance, recruit thresholds) that win most often.

## What the research says

**Evolution strategies (ES) / evolutionary algorithms** are a strong fit for this setting:

- **Scalable**: Easy to parallelize (e.g. evaluate many candidates at once). Shown to scale to large clusters (e.g. OpenAI ES on 80 machines).
- **No gradients**: Don’t need differentiable rewards or value functions; only need a scalar fitness.
- **Noisy / sparse rewards**: ES are robust when the same policy gets different scores across runs; averaging over multiple games per candidate is the standard way to reduce variance.
- **Simple**: Few hyperparameters (population size, mutation strength, elite count). No value networks or credit assignment.

**Bayesian optimization (BO)** is better when:

- Evaluations are **very expensive** and you have a **small budget** (tens of evaluations).
- You want to use a probabilistic model and acquisition functions to choose the next point.

For our case, simulations are cheap and we want to do many of them, so the overhead of BO and the benefit of sample efficiency are less important than straightforward parallelism and robustness. ES is the better fit.

**Population-based training (PBT)** is used when you’re **training** (e.g. neural nets) and tuning hyperparameters **during** that training. We’re not training a network; we’re tuning a fixed rule-based AI. So we use a classic evolutionary loop: evaluate population → select elites → mutate to refill → repeat.

## What we actually do

1. **Population**: N candidate parameter sets (e.g. 12), initialized from default + mutations.
2. **Fitness**: For each candidate, play M games (e.g. 8) vs the current best (baseline), alternating who is North/South. Score = mean over games of (win bonus, loss penalty, cycle bonus, city/pop margin).
3. **Selection**: Keep the top K (e.g. 4) as elites; the best becomes the new baseline for the next generation.
4. **Mutation**: Refill the population by mutating copies of the elites (random perturbation of each param).
5. **Repeat** for G generations (e.g. 20).

So: **one** optimization method (evolutionary), with **multiple games per candidate** to handle noise. No extra systems (no BO, no PBT, no diversity/niche modules). Env overrides (e.g. `TRAIN_POPULATION_SIZE`, `TRAIN_MATCHES_PER_PAIR`) only change the size of the same algorithm.

## Suggested improvements to the optimization model

### Algorithm / fitness

- **Draw handling**: Games that hit `maxCycles` with no conquest are draws. Give draws a small negative or zero fitness component (e.g. `-10`) so evolution still gets a gradient and doesn't treat "long draw" as good.
- **Fitness shaping**: Add small terms for "won quickly" (cycle bonus when winner) or "lost slowly" (cycle bonus when loser) to encourage decisive play and avoid time-wasting strategies.
- **Variance-aware selection**: When ranking candidates, use mean score minus a fraction of std (e.g. `mean - 0.5 * std`) so robust params are preferred over high-variance ones.
- **CMA-ES (optional)**: Replace fixed mutation strength with Covariance Matrix Adaptation ES for continuous params: better scaling and step-size adaptation. Requires a small dependency (e.g. `cma-es` in JS) and passing a single objective per candidate.
- **Diversity / niche**: To avoid collapse to one strategy, occasionally add a few random or "anti-baseline" candidates, or use novelty (e.g. behavior descriptors) so different play styles survive.

### Throughput (CPU)

- **Max out workers**: Set `NUM_WORKERS` to `os.cpus().length - 1` (or 4–8) so all cores evaluate candidates. The current bottleneck is simulation count, not the evolutionary logic.
- **Fewer cycles when possible**: Use a lower `TRAIN_MAX_CYCLES` for early generations and increase for later ones, or stop a game early when one side is clearly ahead (e.g. 2x cities) to save time.
- **Smaller map for more games**: Keep `TRAIN_MAP_SIZE` at 56 (or smaller) so each game is cheap; increase population or matches per candidate instead.
- **Worker stability**: Ensure `train-ai-worker.ts` runs in your env (e.g. compile to JS or use a worker bundle); fix any `ts-node`/path issues so `NUM_WORKERS > 1` doesn't fall back to main thread.

### Where GPU fits (and doesn't)

- **Current setup**: The optimizer is **evolutionary** and the AI is **rule-based** (`AiParams` → `planAiTurn`). There is no neural network and no large matrix math. Simulations are **branchy, stateful, and irregular** (hex grid, variable units/cities, economy). So:
  - **GPU does not accelerate the current training loop.** The hot path is `runSimulation` → `stepSimulation` (economy, AI, movement, combat, siege) in JS/TS. GPUs excel at batch, uniform, numeric workloads; this is the opposite.
- **If you add a neural policy**: Suppose you replace or augment the rule-based AI with a **neural network** that takes state (e.g. tiles, units, cities encoded) and outputs actions or action logits. Then:
  - **Training** that network (e.g. policy gradient, PPO, or evolution of network weights) would use **GPU** for forward/backward passes (TensorFlow.js, PyTorch via ONNX, or WebGPU compute).
  - **Inference** in the sim could stay on CPU (small nets are fast) or run on GPU if you batch many sims and run one inference per batch.
- **Batched simulation on GPU**: Running *many* games in parallel on the GPU would require **reimplementing the game loop** as GPU-friendly code (e.g. WebGPU compute or CUDA): state in buffers, minimal branching, one step per dispatch). That's a large rewrite and the game's structure (dynamic entities, hex topology, economy) doesn't map naturally to shaders. Not recommended unless you have a dedicated GPU-sim project.
- **Practical order of operations**:
  1. **Improve CPU utilization**: Turn on and tune `NUM_WORKERS`, then improve fitness and selection (draw handling, variance, CMA-ES, diversity) as above.
  2. **If you need more throughput**: Scale out to multiple machines (each runs `train-ai` with a different seed or population slice; merge best params periodically)—same ES, more evaluations.
  3. **If you want a neural AI**: Introduce a small policy net, run ES or RL to train it (e.g. with TF.js or WebGPU), and use the GPU for that net; keep the existing sim on CPU or run one sim per worker and do inference in the worker.

## References (high level)

- Evolution strategies as a scalable alternative to RL (OpenAI): ES scales well and handles sparse/noisy rewards.
- Game AI parameter tuning (NTBEA, GVGAI): For **discrete** game params and noisy evaluations, evolutionary and bandit-style methods are standard; we use continuous params and a simple ES.
- DeepMind PBT: Combines exploitation (copy from better) and exploration (perturb); our “new baseline + mutate” is the same idea applied to a non-neural setting.
