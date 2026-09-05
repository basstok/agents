<script setup lang="ts">
import { VPHomeContent, VPHomeFeatures, VPHomeHero } from "vitepress/theme";
</script>

<template>
  <main class="agents-home">
    <VPHomeHero />
    <VPHomeFeatures />
    <VPHomeContent><Content /></VPHomeContent>
  </main>
</template>
