import React from "react";
import { WrappedSearchPage } from "@/components/wrapped/WrappedSearchPage";
import { WrappedStory } from "@/components/wrapped/WrappedStory";
import { useWrappedSearch } from "@/hooks/useWrappedSearch";

export default function WeightliftingWrappedScreen() {
  const search = useWrappedSearch();

  if (search.wrapped) {
    return <WrappedStory wrapped={search.wrapped} onClose={search.closeWrapped} />;
  }

  return <WrappedSearchPage search={search} />;
}
