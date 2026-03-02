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

## References (high level)

- Evolution strategies as a scalable alternative to RL (OpenAI): ES scales well and handles sparse/noisy rewards.
- Game AI parameter tuning (NTBEA, GVGAI): For **discrete** game params and noisy evaluations, evolutionary and bandit-style methods are standard; we use continuous params and a simple ES.
- DeepMind PBT: Combines exploitation (copy from better) and exploration (perturb); our “new baseline + mutate” is the same idea applied to a non-neural setting.
