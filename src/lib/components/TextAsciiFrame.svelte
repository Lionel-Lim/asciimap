<script lang="ts">
	import { buildTextFrameRows } from '$lib/ascii/textFrame';
	import type { EntityKind, AsciiFrame } from '$lib/ascii';

	type RenderEntity = EntityKind | 'background';

	interface Props {
		entityColors: Record<RenderEntity, string>;
		frame: AsciiFrame | null;
		monoFontFamily: string;
	}

	let { entityColors, frame, monoFontFamily }: Props = $props();

	const measureFontSize = 100;
	const widthMeasureText = 'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM';
	const heightMeasureRowCount = 12;
	const heightMeasureText = Array.from({ length: heightMeasureRowCount }, () => 'M').join('\n');
	const rows = $derived(frame ? buildTextFrameRows(frame) : []);
	let measureWidth = $state(widthMeasureText.length * 60);
	let measureHeight = $state(heightMeasureRowCount * measureFontSize);
	const viewportWidth = $derived(frame ? frame.cellWidth * frame.cols : 0);
	const viewportHeight = $derived(frame ? frame.cellHeight * frame.rowCount : 0);
	const glyphAdvanceRatio = $derived(
		measureWidth / Math.max(1, widthMeasureText.length * measureFontSize)
	);
	const lineAdvanceRatio = $derived(measureHeight / Math.max(1, heightMeasureRowCount * measureFontSize));
	const fontSize = $derived(
		frame
			? Math.max(6, viewportWidth / Math.max(1, frame.cols * glyphAdvanceRatio))
			: 12
	);
	const lineHeight = $derived(fontSize * lineAdvanceRatio);
	const contentWidth = $derived(frame ? frame.cols * fontSize * glyphAdvanceRatio : 0);
	const contentHeight = $derived(frame ? frame.rowCount * lineHeight : 0);
	const contentOffsetX = $derived((viewportWidth - contentWidth) / 2);
	const contentOffsetY = $derived((viewportHeight - contentHeight) / 2);
	function segmentStyle(entity: RenderEntity, opacity: number): string {
		return `color:${entityColors[entity]};opacity:${opacity};`;
	}
</script>

<div class="text-render-surface">
	<span
		class="text-measure"
		aria-hidden="true"
		bind:offsetWidth={measureWidth}
		style={`font-family:${monoFontFamily};font-size:${measureFontSize}px;line-height:1;font-kerning:none;font-variant-ligatures:none;font-feature-settings:'liga' 0,'calt' 0;`}
	>
		{widthMeasureText}
	</span>
	<pre
		class="text-measure text-measure-block"
		aria-hidden="true"
		bind:offsetHeight={measureHeight}
		style={`font-family:${monoFontFamily};font-size:${measureFontSize}px;line-height:1;font-kerning:none;font-variant-ligatures:none;font-feature-settings:'liga' 0,'calt' 0;`}
	>{heightMeasureText}</pre>

	{#if frame}
		<div
			class="text-grid"
			style={`left:${contentOffsetX}px;top:${contentOffsetY}px;font-family:${monoFontFamily};font-size:${fontSize}px;line-height:${lineHeight}px;`}
		>
			{#each rows as row (row.index)}
				<div class="text-row">
					{#each row.segments as segment, index (`${row.index}:${index}`)}
						<span class="text-segment" style={segmentStyle(segment.entity, segment.opacity)}>
							{segment.text}
						</span>
					{/each}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.text-render-surface {
		position: absolute;
		inset: 0;
	}

	.text-grid {
		position: absolute;
		width: max-content;
	}

	.text-render-surface,
	.text-grid {
		pointer-events: auto;
		user-select: text;
	}

	.text-grid {
		font-kerning: none;
		font-variant-ligatures: none;
		font-feature-settings:
			'liga' 0,
			'calt' 0;
		text-rendering: optimizeSpeed;
	}

	.text-row,
	.text-segment,
	.text-measure {
		white-space: pre;
	}

	.text-row {
		display: block;
	}

	.text-segment {
		display: inline;
	}

	.text-measure {
		position: absolute;
		top: -9999px;
		left: -9999px;
		visibility: hidden;
		pointer-events: none;
	}

	.text-measure-block {
		margin: 0;
	}
</style>
